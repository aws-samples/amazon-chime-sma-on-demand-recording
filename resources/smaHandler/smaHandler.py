from botocore.client import Config
import logging
import boto3
import json
import os
import time

# Set LogLevel using environment variable, fallback to INFO if not present
logger = logging.getLogger()
try:
    log_level = os.environ["LogLevel"]
    if log_level not in ["INFO", "DEBUG"]:
        log_level = "INFO"
except:
    log_level = "INFO"
logger.setLevel(log_level)

# Load environment variables
wav_bucket = os.environ["WAV_BUCKET"]
recording_bucket = os.environ["RECORDING_BUCKET"]
source_phone = os.environ["SOURCE_PHONE"]
call_records_table = os.environ["CALL_RECORDS_TABLE"]

# Setup DynamoDB interface client to query number mappings
client_config = Config(connect_timeout=2, read_timeout=2, retries={"max_attempts": 5})
dynamodb_client = boto3.client("dynamodb", config=client_config, region_name=os.environ["AWS_REGION"])


# This is the entry point for all incoming events from Chime SipMediaApplications
def lambda_handler(event, context):

    # Extract all the elements from the event that we will need for processing
    event_type = event["InvocationEventType"]
    participants = event["CallDetails"]["Participants"]
    call_id = participants[0]["CallId"]
    to_number = participants[0]["To"]
    from_number = participants[0]["From"]

    if from_number == source_phone:
        direction = "Outbound"
    else:
        direction = "Inbound"

    # For consistent and detail logging, set a prefix format that can be used by all functions
    global log_prefix
    log_prefix = "Call-ID:{} {} ".format(call_id, event_type)

    logger.info("RECV {} {} {}".format(log_prefix, "Receieved Invocation: ", event))

    if event_type == "NEW_INBOUND_CALL":
        logger.info("RECV {} {}".format(log_prefix, "New inbound call initiated"))
        return new_call_handler(call_id, to_number, from_number, direction)

    elif event_type == "HANGUP":
        logger.info("RECV {} {}".format(log_prefix, "Hangup event received"))
        return hangup_handler(participants, event)

    elif event_type == "RINGING":
        logger.info("RECV {} {}".format(log_prefix, "Ringing event received"))
        return ()

    elif event_type == "DIGITS_RECEIVED":
        logger.info("RECV {} {}".format(log_prefix, "Digits received"))
        return digits_received_handler(event)

    elif event_type == "ACTION_SUCCESSFUL":
        return action_success_handler(event)

    elif event_type == "ACTION_FAILED":
        logger.error(
            "RECV {} {} {} {}".format(
                log_prefix, event["ActionData"]["ErrorType"], event["ActionData"]["ErrorMessage"], json.dumps(event)
            )
        )
        return unable_to_connect(call_id)

    elif event_type == "INVALID_LAMBDA_RESPONSE":
        logger.error(
            "RECV {} : {} : {} : {}".format(log_prefix, event["ErrorType"], event["ErrorMessage"], json.dumps(event))
        )
        return unable_to_connect(call_id)

    else:
        logger.error("RECV {} [Unhandled event] {}".format(log_prefix, json.dumps(event)))
        return unable_to_connect(call_id)


def new_call_handler(call_id, to_number, from_number, direction):
    if direction == "Outbound":
        logger.info("INFO {} {}".format(log_prefix, "Call from source phone.  Getting digits to bridge call to."))
        return respond(play_audio_and_get_digits(call_id))

    else:
        logger.info("INFO {} {}".format(log_prefix, "Call from unknown number.  Bridging to source phone."))
        return respond(
            play_this_call_is_being_recorded(call_id),
            play_audio_leg_a("connectingYou.wav"),
            call_and_bridge_to_pstn(from_number, source_phone),
            receive_digits(call_id),
        )


def hangup_handler(participants, event):
    # When we receive a hangup event, we make sure to tear down any calls still connected
    for call in participants:
        if call["Status"] == "Connected":
            return respond(hangup_action(call["CallId"]))
    logger.info("NONE {} All calls have been hungup".format(log_prefix))
    ddb_update_hangup(event)
    return respond()


def digits_received_handler(event):
    action = event["ActionData"]["Type"]
    participants = event["CallDetails"]["Participants"]
    call_id_a = participants[0]["CallId"]
    from_number = participants[0]["From"]
    call_id_b = participants[1]["CallId"]
    digits_received = event["ActionData"]["ReceivedDigits"]

    if from_number == source_phone:
        direction = "Outbound"
        primary_call_id = call_id_b
    else:
        direction = "Inbound"
        primary_call_id = call_id_a

    logger.info("RECV {} {} {}".format(log_level, "Digits Received: ", digits_received))
    if digits_received == "5":
        return respond(
            play_audio_leg_a("recordingPaused.wav"),
            play_audio_leg_b("recordingPaused.wav"),
            pause_call_recording(call_id_a),
            receive_digits(primary_call_id),
        )
    elif digits_received == "6":
        return respond(
            play_audio_leg_a("recordingResumed.wav"),
            play_audio_leg_b("recordingResumed.wav"),
            resume_call_recording(call_id_a),
            receive_digits(primary_call_id),
        )
    elif digits_received == "7":
        return respond(
            play_audio_leg_a("recordingStopped.wav"),
            play_audio_leg_b("recordingStopped.wav"),
            stop_call_recording(call_id_a),
            receive_digits(primary_call_id),
        )
    else:
        return respond()


# If we receive an ACTION_SUCCESSFUL event we can take further actions,
# or default to responding with a NoOp (empty set of actions)
def action_success_handler(event):
    action = event["ActionData"]["Type"]
    participants = event["CallDetails"]["Participants"]
    call_id_a = participants[0]["CallId"]
    from_number = participants[0]["From"]

    if from_number == source_phone:
        direction = "Outbound"
    else:
        direction = "Inbound"

    if action == "Answer":
        return respond()
    elif action == "Hangup":
        return respond()

    elif action == "PlayAudioAndGetDigits":
        dial_number = "+1" + event["ActionData"]["ReceivedDigits"]
        logger.info("RECV {} {} {}".format(log_prefix, "Received Digits.  Bridging to number: ", dial_number))
        return respond(play_audio_leg_a("connectingYou.wav"), call_and_bridge_to_pstn(source_phone, dial_number))

    elif action == "CallAndBridge":
        call_id_b = participants[1]["CallId"]
        logger.info("RECV {} {}".format(log_prefix, "Call Answered.  Start Recording."))
        ddb_update_answered(event, direction)
        if direction == "Outbound":
            return respond(
                play_this_call_is_being_recorded(call_id_a), start_call_recording(call_id_b), receive_digits(call_id_b)
            )
        else:
            return respond(start_call_recording(call_id_a), receive_digits(call_id_a))
    return respond()


# A wrapper for all responses back to the service
def respond(*actions):
    logger.info("INFO {} {} {}".format(log_prefix, "Actions: ", actions))
    return {"SchemaVersion": "1.0", "Actions": [*actions]}


# SipResponseCode can be parameterized. Supported values: '480' - Unavailable, '486' - Busy, '0' - Terminated
# To read more on customizing the hangup action, see https://docs.aws.amazon.com/chime/latest/dg/hangup.html
def hangup_action(call_id):
    logger.info("SEND {} {} {}".format(log_prefix, "Sending HANGUP action to Call-ID", call_id))
    return {"Type": "Hangup", "Parameters": {"CallId": call_id, "SipResponseCode": "0"}}


# Used for playing audio greetings to callers - files should be stored in S3, with the bucket name as a Lambda environment variable
def play_audio(call_id, audio_file):
    return {
        "Type": "PlayAudio",
        "Parameters": {"CallId": call_id, "AudioSource": {"Type": "S3", "BucketName": wav_bucket, "Key": audio_file}},
    }


def call_and_bridge_to_pstn(caller_id, destination):
    return {
        "Type": "CallAndBridge",
        "Parameters": {
            "CallTimeoutSeconds": 30,
            "CallerIdNumber": caller_id,
            "Endpoints": [{"Uri": destination, "BridgeEndpointType": "PSTN"}],
        },
    }


def call_and_bridge_to_pstn_with_greeting(caller_id, destination, audio_file):
    return {
        "Type": "CallAndBridge",
        "Parameters": {
            "CallTimeoutSeconds": 30,
            "CallerIdNumber": caller_id,
            "RingbackTone": {"Type": "S3", "BucketName": os.environ["WavBucketName"], "Key": audio_file},
            "Endpoints": [{"Uri": destination, "BridgeEndpointType": "PSTN"}],
        },
    }


def play_audio_leg_a(audio_file):
    return {
        "Type": "PlayAudio",
        "Parameters": {
            "ParticipantTag": "LEG-A",
            "AudioSource": {"Type": "S3", "BucketName": wav_bucket, "Key": audio_file},
        },
    }


def play_audio_leg_b(audio_file):
    return {
        "Type": "PlayAudio",
        "Parameters": {
            "ParticipantTag": "LEG-B",
            "AudioSource": {"Type": "S3", "BucketName": wav_bucket, "Key": audio_file},
        },
    }


def play_this_call_is_being_recorded(call_id):
    return {
        "Type": "PlayAudio",
        "Parameters": {
            "CallId": call_id,
            "AudioSource": {"Type": "S3", "BucketName": wav_bucket, "Key": "thisCallIsBeingRecorded.wav"},
        },
    }


def play_audio_and_get_digits(call_id):
    return {
        "Type": "PlayAudioAndGetDigits",
        "Parameters": {
            "MinNumberOfDigits": 10,
            "MaxNumberOfDigits": 15,
            "Repeat": 3,
            "InBetweenDigitsDurationInMilliseconds": 2500,
            "RepeatDurationInMilliseconds": 5000,
            "TerminatorDigits": ["#"],
            "AudioSource": {"Type": "S3", "BucketName": wav_bucket, "Key": "enterNumberToDial.wav"},
            "FailureAudioSource": {"Type": "S3", "BucketName": wav_bucket, "Key": "sorryIDidntGetThat.wav"},
        },
    }


def play_this_call_is_being_recorded(call_id):
    return {
        "Type": "PlayAudio",
        "Parameters": {
            "CallId": call_id,
            "AudioSource": {"Type": "S3", "BucketName": wav_bucket, "Key": "thisCallIsBeingRecorded.wav"},
        },
    }


def pause_call_recording(call_id):
    return {"Type": "PauseCallRecording", "Parameters": {"CallId": call_id}}


def resume_call_recording(call_id):
    return {"Type": "ResumeCallRecording", "Parameters": {"CallId": call_id}}


def stop_call_recording(call_id):
    return {"Type": "StopCallRecording", "Parameters": {"CallId": call_id}}


def start_call_recording(call_id):
    return {
        "Type": "StartCallRecording",
        "Parameters": {
            "CallId": call_id,
            "Track": "BOTH",
            "Destination": {"Type": "S3", "Location": recording_bucket + "/originalAudio"},
        },
    }


def receive_digits(call_id):
    return {
        "Type": "ReceiveDigits",
        "Parameters": {
            "InputDigitsRegex": "[5-7]",
            "CallId": call_id,
            "InBetweenDigitsDurationInMilliseconds": 1000,
            "FlushDigitsDurationInMilliseconds": 10000,
        },
    }


def pause_actions():
    return {"Type": "Pause", "Parameters": {"DurationInMilliseconds": "2000"}}


# A predefined set of actions that plays an error to the caller and then hangs up
def unable_to_connect(call_id):
    return respond(play_audio(call_id, "we_were_unable_to_connect_your_call.wav"), hangup_action(call_id))


def ddb_update_answered(event, direction):
    try:
        response = dynamodb_client.update_item(
            Key={
                "callID": {
                    "S": str(event["CallDetails"]["TransactionId"]),
                },
            },
            TableName=call_records_table,
            UpdateExpression="set direction = :d, caller = :c, callee = :ca, startTime = :s",
            ExpressionAttributeValues={
                ":d": {"S": direction},
                ":c": {"S": event["CallDetails"]["Participants"][0]["From"]},
                ":ca": {"S": event["CallDetails"]["Participants"][0]["To"]},
                ":s": {"S": str(time.time())},
            },
        )
        logger.info("DATABASE {} {}".format(log_prefix, "Database Updated"))
        return None
    except Exception as err:
        logger.error("DynamoDB Query error: failed to fetch data from table. Error: ", exc_info=err)
        return None


def ddb_update_hangup(event):
    try:
        response = dynamodb_client.update_item(
            Key={
                "callID": {
                    "S": str(event["CallDetails"]["TransactionId"]),
                },
            },
            TableName=call_records_table,
            UpdateExpression="set endTime = :e",
            ExpressionAttributeValues={":e": {"S": str(time.time())}},
        )
        logger.info("DATABASE {} {}".format(log_prefix, "Database Updated"))
        return None
    except Exception as err:
        logger.error("DynamoDB Query error: failed to fetch data from table. Error: ", exc_info=err)
        return None
