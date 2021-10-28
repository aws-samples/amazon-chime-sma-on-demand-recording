import * as cdk from "@aws-cdk/core";
import s3 = require("@aws-cdk/aws-s3");
import iam = require("@aws-cdk/aws-iam");
import lambda = require("@aws-cdk/aws-lambda");
import s3deploy = require("@aws-cdk/aws-s3-deployment");
import { PolicyStatement } from "@aws-cdk/aws-iam";
import custom = require("@aws-cdk/custom-resources");
import { CfnOutput, CustomResource, Duration } from "@aws-cdk/core";
import * as sns from "@aws-cdk/aws-sns";
import * as subs from "@aws-cdk/aws-sns-subscriptions";
import { Architecture } from "@aws-cdk/aws-lambda";
import * as ssm from "@aws-cdk/aws-ssm";
import { PythonFunction } from "@aws-cdk/aws-lambda-python";
import dynamodb = require("@aws-cdk/aws-dynamodb");
import * as sfn from "@aws-cdk/aws-stepfunctions";
import * as tasks from "@aws-cdk/aws-stepfunctions-tasks";
import * as logs from "@aws-cdk/aws-logs";
import { S3EventSource } from "@aws-cdk/aws-lambda-event-sources";
import { LambdaFunction } from "@aws-cdk/aws-events-targets";

export class AmazonChimeSmaRecording extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const sourcePhoneNumber = new cdk.CfnParameter(this, "sourcePhoneNumber", {
      type: "String",
      description: "Source Phone Number",
    });

    new ssm.StringParameter(this, "sourcePhoneNumberParameter", {
      parameterName: "/chimeSMARecording/sourcePhoneNumber",
      stringValue: sourcePhoneNumber.valueAsString,
    });

    const emailSubscription = new cdk.CfnParameter(this, "emailSubscription", {
      type: "String",
      description: "Email Address to Send Notifications to",
      allowedPattern:
        "^[\\x20-\\x45]?[\\w-\\+]+(\\.[\\w]+)*@[\\w-]+(\\.[\\w]+)*(\\.[a-z]{2,})$",
    });

    new ssm.StringParameter(this, "emailSubscriptionParameter", {
      parameterName: "/chimeSMARecording/emailSubscription",
      stringValue: emailSubscription.valueAsString,
    });

    const callRecordsTable = new dynamodb.Table(this, "callRecordsTable", {
      partitionKey: {
        name: "callID",
        type: dynamodb.AttributeType.STRING,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "TTL",
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const outgoingWav = new s3.Bucket(this, "outgoingWav", {
      publicReadAccess: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new s3deploy.BucketDeployment(this, "WavDeploy", {
      sources: [s3deploy.Source.asset("./wav_files")],
      destinationBucket: outgoingWav,
      contentType: "audio/wav",
    });

    const recordingBucket = new s3.Bucket(this, "recordingBucket", {
      publicReadAccess: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const outgoingWavBucketPolicy = new PolicyStatement({
      principals: [
        new iam.ServicePrincipal("voiceconnector.chime.amazonaws.com"),
      ],
      effect: iam.Effect.ALLOW,
      actions: ["s3:GetObject", "s3:PutObject", "s3:PutObjectAcl"],
      resources: [outgoingWav.bucketArn, `${outgoingWav.bucketArn}/*`],
      sid: "SIPMediaApplicationRead",
    });

    const recordingBucketPolicy = new PolicyStatement({
      principals: [
        new iam.ServicePrincipal("voiceconnector.chime.amazonaws.com"),
      ],
      effect: iam.Effect.ALLOW,
      actions: ["s3:GetObject", "s3:PutObject", "s3:PutObjectAcl"],
      resources: [recordingBucket.bucketArn, `${recordingBucket.bucketArn}/*`],
      sid: "SIPMediaApplicationRead",
    });

    outgoingWav.addToResourcePolicy(outgoingWavBucketPolicy);
    recordingBucket.addToResourcePolicy(recordingBucketPolicy);

    const notificationTopic = new sns.Topic(this, "notificationTopic", {
      displayName: "Notification Topic for Transcribe Output",
    });

    notificationTopic.addSubscription(
      new subs.EmailSubscription(emailSubscription.valueAsString)
    );

    const smaLambdaRole = new iam.Role(this, "smaLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        ["chimePolicy"]: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              resources: ["*"],
              actions: ["chime:*"],
            }),
          ],
        }),
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });

    const smaHandler = new lambda.Function(this, "smaHandler", {
      code: lambda.Code.fromAsset("src/smaHandler"),
      architectures: [Architecture.ARM_64],
      handler: "smaHandler.lambda_handler",
      runtime: lambda.Runtime.PYTHON_3_9,
      environment: {
        WAV_BUCKET: outgoingWav.bucketName,
        RECORDING_BUCKET: recordingBucket.bucketName,
        SOURCE_PHONE: sourcePhoneNumber.valueAsString,
        CALL_RECORDS_TABLE: callRecordsTable.tableName,
      },
      role: smaLambdaRole,
    });

    recordingBucket.grantReadWrite(smaHandler);

    const chimeCreateRole = new iam.Role(this, "createChimeLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        ["chimePolicy"]: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              resources: ["*"],
              actions: [
                "chime:CreateSipRule",
                "chime:GetPhoneNumberOrder",
                "chime:CreateSipMediaApplication",
                "chime:CreatePhoneNumberOrder",
                "chime:SearchAvailablePhoneNumbers",
                "lambda:GetPolicy",
                "lambda:AddPermission",
                "cloudformation:DescribeStacks",
              ],
            }),
          ],
        }),
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });

    const createSMALambda = new lambda.Function(this, "createSMALambda", {
      code: lambda.Code.fromAsset("src/createChimeResources"),
      handler: "createChimeResources.on_event",
      runtime: lambda.Runtime.PYTHON_3_9,
      role: chimeCreateRole,
      timeout: Duration.seconds(60),
    });

    const chimeSMAProvider = new custom.Provider(this, "chimeProvider", {
      onEventHandler: createSMALambda,
    });

    const smaResources = new CustomResource(this, "smaResources", {
      serviceToken: chimeSMAProvider.serviceToken,
      properties: {
        lambdaArn: smaHandler.functionArn,
        region: this.region,
        smaName: this.stackName,
        phoneNumberRequired: true,
      },
    });

    const transcribeLambdaRole = new iam.Role(this, "transcribeLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        Trancribe: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              resources: ["*"],
              actions: ["transcribe:StartCallAnalyticsJob"],
            }),
            new iam.PolicyStatement({
              resources: [
                `${recordingBucket.bucketArn}`,
                `${recordingBucket.bucketArn}/*`,
              ],
              actions: ["*"],
            }),
          ],
        }),
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });

    const transcribeServiceRole = new iam.Role(this, "transcribeServiceRole", {
      assumedBy: new iam.ServicePrincipal("transcribe.amazonaws.com"),
      inlinePolicies: {
        Trancribe: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              resources: [
                `${recordingBucket.bucketArn}`,
                `${recordingBucket.bucketArn}/*`,
              ],
              actions: ["s3:*"],
            }),
            new iam.PolicyStatement({
              resources: [`arn:aws:kms:${this.region}:${this.account}:key/*`],
              actions: ["kms:Decrypt"],
            }),
          ],
        }),
      },
    });

    const transcribeLambda = new PythonFunction(this, "transcribeLambda", {
      entry: "src/transcribe",
      index: "transcribe.py",
      handler: "lambda_handler",
      runtime: lambda.Runtime.PYTHON_3_9,
      architectures: [Architecture.ARM_64],
      role: transcribeLambdaRole,
      timeout: Duration.seconds(60),
      environment: {
        DATA_ACCESS_ROLE: transcribeServiceRole.roleArn,
        RECORDING_BUCKET: recordingBucket.bucketName,
        CALL_RECORDS_TABLE: callRecordsTable.tableName,
      },
    });

    const createOutputLambdaRole = new iam.Role(
      this,
      "createOutputLambdaRole",
      {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        inlinePolicies: {
          Trancribe: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                resources: ["*"],
                actions: [
                  "transcribe:GetTranscriptionJob",
                  "transcribe:GetCallAnalyticsJob",
                ],
              }),
            ],
          }),
        },
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSLambdaBasicExecutionRole"
          ),
        ],
      }
    );

    const createOutputLambda = new lambda.DockerImageFunction(
      this,
      "createOutputLambda",
      {
        code: lambda.DockerImageCode.fromImageAsset("src/createOutput", {
          cmd: ["app.handler"],
        }),
        role: createOutputLambdaRole,
        architectures: [Architecture.X86_64],
        timeout: Duration.seconds(300),
        environment: {
          RECORDING_BUCKET: recordingBucket.bucketName,
          SNS_TOPIC: notificationTopic.topicArn,
          CALL_RECORDS_TABLE: callRecordsTable.tableName,
        },
      }
    );

    notificationTopic.grantPublish(createOutputLambda);
    recordingBucket.grantReadWrite(createOutputLambda);

    callRecordsTable.grantReadWriteData(transcribeLambda);
    callRecordsTable.grantReadWriteData(smaHandler);
    callRecordsTable.grantReadWriteData(createOutputLambda);

    const phoneNumber = smaResources.getAttString("phoneNumber");
    const smaID = smaResources.getAttString("smaID");
    const sipRuleID = smaResources.getAttString("sip_rule_id");

    new CfnOutput(this, "phoneNumber", { value: phoneNumber });
    new CfnOutput(this, "smaID", { value: smaID });
    new CfnOutput(this, "sipRuleID", { value: sipRuleID });

    new CfnOutput(this, "callRecordsTableOutput", {
      value: callRecordsTable.tableName,
    });
    new CfnOutput(this, "wavBucketOutput", { value: outgoingWav.bucketName });
    new CfnOutput(this, "recordingBucketOutput", {
      value: recordingBucket.bucketName,
    });

    const transcribeTask = new tasks.LambdaInvoke(this, "transcribeTask", {
      lambdaFunction: transcribeLambda,
      outputPath: "$.Payload",
    });

    const createOutputTask = new tasks.LambdaInvoke(this, "createOutputTask", {
      lambdaFunction: createOutputLambda,
      outputPath: "$.Payload",
    });

    const wait = new sfn.Wait(this, "Wait", {
      time: sfn.WaitTime.duration(Duration.seconds(30)),
    });

    const fail = new sfn.Fail(this, "Fail", {
      error: "WorkflowFailure",
      cause: "Unknown",
    });

    const checkTranscribeTask = new tasks.CallAwsService(
      this,
      "checkTranscribeTask",
      {
        service: "transcribe",
        action: "getCallAnalyticsJob",
        iamResources: ["*"],
        iamAction: "transcribe:GetCallAnalyticsJob",
        resultPath: "$.CheckOutput",
        parameters: { "CallAnalyticsJobName.$": "$.callAnalyticsJobName" },
      }
    );

    const definition = transcribeTask
      .next(wait)
      .next(checkTranscribeTask)
      .next(
        new sfn.Choice(this, "TranscribeChoice")
          .when(
            sfn.Condition.stringEquals(
              "$.CheckOutput.CallAnalyticsJob.CallAnalyticsJobStatus",
              "COMPLETED"
            ),
            createOutputTask
          )
          .when(
            sfn.Condition.stringEquals(
              "$.CheckOutput.CallAnalyticsJob.CallAnalyticsJobStatus",
              "FAILED"
            ),
            fail
          )
          .otherwise(wait)
      );

    const processRecordingMachineRole = new iam.Role(
      this,
      "processRecordingMachineRole",
      {
        assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
        inlinePolicies: {
          Trancribe: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                resources: ["*"],
                actions: [
                  "transcribe:*",
                  "logs:CreateLogDelivery",
                  "logs:GetLogDelivery",
                  "logs:UpdateLogDelivery",
                  "logs:DeleteLogDelivery",
                  "logs:ListLogDeliveries",
                  "logs:PutResourcePolicy",
                  "logs:DescribeResourcePolicies",
                  "logs:DescribeLogGroups",
                ],
              }),
            ],
          }),
        },
      }
    );

    const processRecordingMachine = new sfn.StateMachine(
      this,
      "processRecordingMachine",
      {
        definition: definition,
        timeout: cdk.Duration.minutes(15),
        tracingEnabled: true,
        role: processRecordingMachineRole,
        logs: {
          level: sfn.LogLevel.ALL,
          destination: new logs.LogGroup(this, "processRecordingMachineLogs", {
            logGroupName: "/aws/vendedlogs/states/" + this.stackName,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: logs.RetentionDays.ONE_WEEK,
          }),
        },
      }
    );

    const triggerStateMachineLambda = new lambda.Function(
      this,
      "triggerStateMachineLambda",
      {
        code: lambda.Code.fromAsset("src/triggerStateMachine"),
        handler: "trigger.lambda_handler",
        runtime: lambda.Runtime.PYTHON_3_9,
        timeout: Duration.seconds(60),
        architectures: [Architecture.ARM_64],
        environment: {
          STATE_MACHINE: processRecordingMachine.stateMachineArn,
          CALL_RECORDS_TABLE: callRecordsTable.tableName,
        },
      }
    );

    triggerStateMachineLambda.addEventSource(
      new S3EventSource(recordingBucket, {
        events: [s3.EventType.OBJECT_CREATED],
        filters: [{ prefix: "recordings/" }],
      })
    );

    processRecordingMachine.grantStartExecution(triggerStateMachineLambda);
    callRecordsTable.grantReadWriteData(triggerStateMachineLambda);
  }
}
