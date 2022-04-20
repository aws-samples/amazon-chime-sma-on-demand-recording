import { App, Stack, StackProps, CfnParameter, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Chime } from './chime';
import { Infrastructure } from './infrastructure';
import { Parameters } from './parameters';

export class OnDemandRecording extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const sourcePhoneNumber = new CfnParameter(this, 'sourcePhoneNumber', {
      type: 'String',
      description: 'Source Phone Number',
    });

    new Parameters(this, 'Parameters', {
      sourcePhoneNumber: sourcePhoneNumber.valueAsString,
    });

    const infrastructure = new Infrastructure(this, 'Infrastructure', {});

    const chime = new Chime(this, 'Chime', {
      sourcePhoneNumber: sourcePhoneNumber.valueAsString,
      outgoingWav: infrastructure.outgoingWav,
      recordingBucket: infrastructure.recordingBucket,
      callRecordsTable: infrastructure.callRecordsTable,
    });

    new CfnOutput(this, 'recordingBucket', {
      value: infrastructure.recordingBucket.bucketName,
    });
    new CfnOutput(this, 'recordingNumber', { value: chime.recordingNumber });
  }
}

const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-1',
};

const app = new App();

new OnDemandRecording(app, 'OnDemandRecording', { env: devEnv });

app.synth();
