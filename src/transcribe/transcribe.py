import boto3
import os
import json
from botocore.client import Config
import logging
import uuid

RECORDING_BUCKET = os.environ["RECORDING_BUCKET"]
DATA_ACCESS_ROLE = os.environ["DATA_ACCESS_ROLE"]
CALL_RECORDS_TABLE = os.environ["CALL_RECORDS_TABLE"]
transcribe = boto3.client("transcribe")

client_config = Config(connect_timeout=2, read_timeout=2, retries={"max_attempts": 5})
dynamodb_client = boto3.client("dynamodb", config=client_config, region_name=os.environ["AWS_REGION"])

logger = logging.getLogger()
try:
    log_level = os.environ["LogLevel"]
    if log_level not in ["INFO", "DEBUG"]:
        log_level = "INFO"
except:
    log_level = "INFO"
logger.setLevel(log_level)


def lambda_handler(event, context):
    bucket = event["bucket"]
    key = event["key"]
    call_id = event["call_id"]
    recording_date = event["recording_date"]
    direction = event["direction"]

    if direction == "Inbound":
        role_0 = "AGENT"
        role_1 = "CUSTOMER"
    else:
        role_0 = "CUSTOMER"
        role_1 = "AGENT"

    call_analyitcs_job_name = str(uuid.uuid4())
    ddb_update_recording(call_id, call_analyitcs_job_name)

    response = transcribe.start_call_analytics_job(
        CallAnalyticsJobName=call_analyitcs_job_name,
        Media={"MediaFileUri": "s3://" + bucket + "/" + key},
        DataAccessRoleArn=DATA_ACCESS_ROLE,
        OutputLocation="s3://" + bucket + "/transcriptions/" + recording_date + "/" + call_id + ".json",
        Settings={"LanguageOptions": ["en-US"]},
        ChannelDefinitions=[
            {"ChannelId": 0, "ParticipantRole": role_0},
            {"ChannelId": 1, "ParticipantRole": role_1},
        ],
    )
    logger.info("Call Analytics Job started: {}".format(response))
    call_analyitcs_job_name = response["CallAnalyticsJob"]["CallAnalyticsJobName"]

    return {"callAnalyticsJobName": call_analyitcs_job_name, "call_id": call_id, "bucket": bucket, "recording_key": key}


def ddb_update_recording(call_id, call_analytics_job):
    try:
        response = dynamodb_client.update_item(
            Key={
                "callID": {
                    "S": call_id,
                },
            },
            TableName=CALL_RECORDS_TABLE,
            UpdateExpression="set callAnalyticsJob = :c",
            ExpressionAttributeValues={":c": {"S": call_analytics_job}},
        )
        logger.info("DATABASE {}: {}".format("Database Updated", response))
        return None
    except Exception as err:
        logger.error("DynamoDB Update error: failed to update database. Error: ", exc_info=err)
        return None
