 #!/bin/bash
EmailRegex="^[a-z0-9!#\$%&'*+/=?^_\`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_\`{|}~-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?\$"
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
if ! [ -x "$(command -v cdk)" ]; then
  echo 'Error: cdk is not installed.' >&2
  exit 1
fi
if ! [ -x "$(command -v jq)" ]; then
  echo 'Error: jq is not installed.' >&2
  exit 1
fi
if ! [ -x "$(command -v poetry)" ]; then
  echo 'Error: poetry is not installed.' >&2
  exit 1
fi
if [ -f "cdk.context.json" ]; then
    echo ""
    echo "INFO: Removing cdk.context.json"
    rm cdk.context.json
else
    echo ""
    echo "INFO: cdk.context.json not present, nothing to remove"
fi
echo ""
echo "Getting Parameters"
EmailSub=$( aws ssm get-parameters --names /chimeSMARecording/emailSubscription | jq -r '.Parameters[0].Value' )
if [ $EmailSub == "null" ]; then
  while  [[ !($EmailSub =~ $EmailRegex) ]]; do
    read -p "Valid email address needed: " EmailSub
  done
fi
SourcePhone=$( aws ssm get-parameters --names /chimeSMARecording/sourcePhoneNumber | jq -r '.Parameters[0].Value' )
if [ $SourcePhone == "null" ]; then
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
yarn run build
echo ""
echo "Bootstrapping CDK"
echo ""
cdk bootstrap
echo ""
echo "Deploying CDK"
echo ""
cdk deploy --parameters emailSubscription=$EmailSub --parameters sourcePhoneNumber=$SourcePhone


