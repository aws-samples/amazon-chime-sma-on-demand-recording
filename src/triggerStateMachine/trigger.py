import boto3
import os
import json
from botocore.client import Config
import logging
import uuid

# Set LogLevel using environment variable, fallback to INFO if not present
logger = logging.getLogger()
try:
    log_level = os.environ["LogLevel"]
    if log_level not in ["INFO", "DEBUG"]:
        log_level = "INFO"
except:
    log_level = "INFO"
logger.setLevel(log_level)

stepfunctions = boto3.client("stepfunctions")
client_config = Config(connect_timeout=2, read_timeout=2, retries={"max_attempts": 5})
dynamodb_client = boto3.client("dynamodb", config=client_config, region_name=os.environ["AWS_REGION"])

STATE_MACHINE = os.environ["STATE_MACHINE"]
CALL_RECORDS_TABLE = os.environ["CALL_RECORDS_TABLE"]


def lambda_handler(event, context):
    bucket = event["Records"][0]["s3"]["bucket"]["name"]
    key = event["Records"][0]["s3"]["object"]["key"]
    call_id = key.split("/", 4)[4].split("_", 2)[1].split(".", 1)[0]
    recording_date = "/".join(key.split("/", 4)[1:4])
    direction = ddb_get_direction(call_id)

    step_function_input = {
        "call_id": call_id,
        "bucket": bucket,
        "key": key,
        "recording_date": recording_date,
        "direction": direction,
    }

    state_machine_name = str(uuid.uuid4())
    ddb_update_recording(call_id, key, state_machine_name)
    logger.info("Preparing to start Step Function with following input: {}".format(step_function_input))
    response = stepfunctions.start_execution(
        stateMachineArn=STATE_MACHINE,
        name=state_machine_name,
        input=json.dumps(step_function_input),
    )

    return str(response)


def ddb_get_direction(call_id):
    try:
        response = dynamodb_client.get_item(
            Key={
                "callID": {
                    "S": call_id,
                },
            },
            TableName=CALL_RECORDS_TABLE,
        )
        if "Item" in response:
            return response["Item"]["direction"]["S"]
    except Exception as err:
        logger.error("DynamoDB Query error: failed to fetch data from table. Error: ", exc_info=err)
        return None


def ddb_update_recording(call_id, key, state_machine_name):
    try:
        response = dynamodb_client.update_item(
            Key={
                "callID": {
                    "S": call_id,
                },
            },
            TableName=CALL_RECORDS_TABLE,
            UpdateExpression="set recording_key = :k, stateMachine = :s",
            ExpressionAttributeValues={":k": {"S": key}, ":s": {"S": state_machine_name}},
        )
        logger.info("DATABASE {}: {}".format("Database Updated", response))
        return None
    except Exception as err:
        logger.error("DynamoDB Update error: failed to update database. Error: ", exc_info=err)
        return None
