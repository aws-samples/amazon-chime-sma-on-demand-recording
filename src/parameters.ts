import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

interface ParameterProps {
  readonly sourcePhoneNumber: string;
}

export class Parameters extends Construct {
  constructor(scope: Construct, id: string, props: ParameterProps) {
    super(scope, id);

    new ssm.StringParameter(this, 'sourcePhoneNumberParameter', {
      parameterName: '/chimeSMARecording/sourcePhoneNumber',
      stringValue: props.sourcePhoneNumber,
    });
  }
}
