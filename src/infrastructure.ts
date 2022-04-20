import { NestedStackProps, NestedStack, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

interface InfrastructureProps extends NestedStackProps {}

export class Infrastructure extends NestedStack {
  public callRecordsTable: dynamodb.Table;
  public outgoingWav: s3.Bucket;
  public recordingBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: InfrastructureProps) {
    super(scope, id, props);

    this.callRecordsTable = new dynamodb.Table(this, 'callRecordsTable', {
      partitionKey: {
        name: 'callID',
        type: dynamodb.AttributeType.STRING,
      },
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'TTL',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    this.outgoingWav = new s3.Bucket(this, 'outgoingWav', {
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new s3deploy.BucketDeployment(this, 'WavDeploy', {
      sources: [s3deploy.Source.asset('./wav_files')],
      destinationBucket: this.outgoingWav,
      contentType: 'audio/wav',
    });

    const outgoingWavBucketPolicy = new iam.PolicyStatement({
      principals: [
        new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com'),
      ],
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:PutObject', 's3:PutObjectAcl'],
      resources: [
        this.outgoingWav.bucketArn,
        `${this.outgoingWav.bucketArn}/*`,
      ],
      sid: 'SIPMediaApplicationRead',
    });

    this.outgoingWav.addToResourcePolicy(outgoingWavBucketPolicy);

    this.recordingBucket = new s3.Bucket(this, 'recordingBucket', {
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const recordingBucketPolicy = new iam.PolicyStatement({
      principals: [
        new iam.ServicePrincipal('voiceconnector.chime.amazonaws.com'),
      ],
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:PutObject', 's3:PutObjectAcl'],
      resources: [
        this.recordingBucket.bucketArn,
        `${this.recordingBucket.bucketArn}/*`,
      ],
      sid: 'SIPMediaApplicationRead',
    });

    this.recordingBucket.addToResourcePolicy(recordingBucketPolicy);
  }
}
