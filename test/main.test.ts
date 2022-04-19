import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OnDemandRecording } from '../src/amazon-chime-sma-on-demand-recording';

test('Snapshot', () => {
  const app = new App();
  const stack = new OnDemandRecording(app, 'test');

  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});
