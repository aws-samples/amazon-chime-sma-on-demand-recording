import { NestedStackProps, NestedStack } from 'aws-cdk-lib';

import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

interface ParameterProps extends NestedStackProps {
  readonly sourcePhoneNumber: string;
}

export class Parameters extends NestedStack {
  constructor(scope: Construct, id: string, props: ParameterProps) {
    super(scope, id, props);

    new ssm.StringParameter(this, 'sourcePhoneNumberParameter', {
      parameterName: '/chimeSMARecording/sourcePhoneNumber',
      stringValue: props.sourcePhoneNumber,
    });
  }
}
