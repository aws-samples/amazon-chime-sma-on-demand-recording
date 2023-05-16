#!/bin/zsh

number=$(aws ssm get-parameter --name /chimeSMARecording/sourcePhoneNumber --query 'Parameter.Value' --output text 2>/dev/null)

while [[ ! $number =~ "^\\+1[2-9][0-9]{2}[2-9][0-9]{6}$" ]]; do
  read "?Enter a valid NANP phone number in E.164 format: " number
done

yarn cdk deploy --parameters sourcePhoneNumber=$number