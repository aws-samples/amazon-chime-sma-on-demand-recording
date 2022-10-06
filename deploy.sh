 #!/bin/bash
PhoneRegex="^\+[1-9][0-9]{1,14}$"
if ! [ -x "$(command -v node)" ]; then
  echo 'Error: node is not installed.' >&2
  exit 1
fi
NODEVER="$(node --version)"
REQNODE="v12.0.0"
if ! [ "$(printf '%s\n' "$REQNODE" "$NODEVER" | sort -V | head -n1)" = "$REQNODE" ]; then 
    echo 'node must be version 12+'
    exit 1
fi
if ! [ -x "$(command -v npm)" ]; then
  echo 'Error: npm is not installed.' >&2
  exit 1
fi
if ! [ -x "$(command -v aws)" ]; then
  echo 'Error: aws is not installed.' >&2
  exit 1
fi
if ! [ -x "$(command -v jq)" ]; then
  echo 'Error: jq is not installed.' >&2
  exit 1
fi
echo ""
echo "Getting Parameters"
SourcePhone=$( aws ssm get-parameters --names /chimeSMARecording/sourcePhoneNumber | jq -r '.Parameters[0].Value' )
if [[ $SourcePhone == "null" ]]; then
  while  [[ !($SourcePhone =~ $PhoneRegex) ]]; do
    read -p "Valid E.164 phone number needed (Ex: +13125551212): " SourcePhone
  done
fi
echo ""
echo "Installing Packages"
echo ""
yarn
echo ""
echo "Building CDK"
echo ""
yarn projen build
echo ""
echo "Bootstrapping CDK"
echo ""
yarn cdk bootstrap
echo ""
echo "Deploying CDK"
echo ""
yarn cdk deploy --parameters emailSubscription=$EmailSub --parameters sourcePhoneNumber=$SourcePhone
