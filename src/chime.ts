import { NestedStackProps, NestedStack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as chime from 'cdk-amazon-chime-resources';
import { Construct } from 'constructs';
interface ChimeProps extends NestedStackProps {
  readonly sourcePhoneNumber: string;
  // readonly emailSubscription: string;
  outgoingWav: s3.Bucket;
  recordingBucket: s3.Bucket;
  callRecordsTable: dynamodb.Table;
}

export class Chime extends NestedStack {
  public smaHandler: lambda.Function;
  public recordingNumber: string;

  constructor(scope: Construct, id: string, props: ChimeProps) {
    super(scope, id, props);

    const smaLambdaRole = new iam.Role(this, 'smaLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        ['chimePolicy']: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              resources: ['*'],
              actions: ['chime:*'],
            }),
          ],
        }),
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
      ],
    });

    this.smaHandler = new lambda.Function(this, 'smaHandler', {
      code: lambda.Code.fromAsset('resources/smaHandler'),
      architecture: lambda.Architecture.ARM_64,
      handler: 'smaHandler.lambda_handler',
      runtime: lambda.Runtime.PYTHON_3_9,
      environment: {
        WAV_BUCKET: props.outgoingWav.bucketName,
        RECORDING_BUCKET: props.recordingBucket.bucketName,
        SOURCE_PHONE: props.sourcePhoneNumber,
        CALL_RECORDS_TABLE: props.callRecordsTable.tableName,
      },
      role: smaLambdaRole,
    });

    props.recordingBucket.grantReadWrite(this.smaHandler);

    const phoneNumber = new chime.ChimePhoneNumber(this, 'smaPhoneNumber', {
      phoneState: 'IL',
      phoneCountry: chime.PhoneCountry.US,
      phoneProductType: chime.PhoneProductType.SMA,
      phoneNumberType: chime.PhoneNumberType.LOCAL,
    });
    const sipMediaApp = new chime.ChimeSipMediaApp(this, 'sipMediaApp', {
      region: this.region,
      endpoint: this.smaHandler.functionArn,
    });

    new chime.ChimeSipRule(this, 'sipRule', {
      triggerType: chime.TriggerType.TO_PHONE_NUMBER,
      triggerValue: phoneNumber.phoneNumber,
      targetApplications: [
        {
          region: this.region,
          priority: 1,
          sipMediaApplicationId: sipMediaApp.sipMediaAppId,
        },
      ],
    });

    this.recordingNumber = phoneNumber.phoneNumber;
  }
}
