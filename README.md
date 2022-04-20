# Amazon Chime SIP Media Application On-Demand Recording

This demo will build and configure several services within AWS so that you can record and process calls through Amazon Chime SIP media application.

## Overview

![Overview](images/sma-on-demand-recording.png)

## Requirements

- node V12+ [installed](https://nodejs.org/en/download/)
- yarn [installed](https://yarnpkg.com/getting-started/install)
- jq [installed](https://stedolan.github.io/jq/download/)
- AWS CLI [installed](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- Deployment must be done in us-east-1
- SourcePhone - an E.164 number used as the primary number that will used as the primary phone number

## Resources Created

- outboundWav S3 Bucket - Used for Amazon Chime SIP media application wav files
- recording S3 Bucket - Used for storage of raw recordings, transcriptions, and processed output
- smaHandler Lambda - Lambda used by SIP media application to process calls
- callRecords Table - DynamoDB Table for storing callRecords
- SIP media application Resources
- - Phone Number - a number that can be called by SourcePhone number to dial out to PSTN, or by PSTN to dial to SourcePhone
- - SIP rule - a SIP media application rule that will trigger on the dialed number

## Deployment

- Clone this repo: `git clone https://github.com/aws-samples/amazon-chime-sma-on-demand-recording`
- `cd amazon-chime-sma-on-demand-recording`
- `yarn launch`
- Accept prompts for CDK deployment and enter phone number to be used as the source phone number

All resources will be deployed in `us-east-1`.

Additionally, a companion deployment can be used in conjunction with this demo. The [Amazon Transcribe Post Call Analytics](https://github.com/aws-samples/amazon-transcribe-post-call-analytics) demo includes an optional input S3 bucket parameter. To use these two demos together, simply use the ouput `recordingBucket` as the input bucket when deploying the Amazon Transcribe Post Call Analytics CloudFormation template and the output from this demo will feed into the input for that demo. Please reference that repository for more information on requirements, what is built, and how it works.

Direct Cloudformation deployment for Amazon Transcribe Post Call Analytics:

| Region name           | Region code | Launch                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US East (N. Virginia) | us-east-1   | [![Launch Stack](https://cdn.rawgit.com/buildkite/cloudformation-launch-stack-button-svg/master/launch-stack.svg)](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=https://s3.us-east-1.amazonaws.com/aws-ml-blog-us-east-1/artifacts/pca/pca-main.yaml&stackName=PostCallAnalytics) |

## Description

This demo will demonstrate how to build and configure an Amazon Chime SIP media application that will allow a person to automatically record inbound and outbound calls.

## Using the Demo

After successfully deploying the CDK components, take note of the phone number in the output. This is the phone number that will be used by the application owner and external users. If the application owner calls this number from the source number provided during deployment, a prompt will be played to enter a phone number to be called. Once entered, that phone number will be called from the SIP media application. Once answered, a prompt will be played to the receiving party informing them that the call will be recorded. When the call ends and both parties have disconnected, a wav file is written to an S3 bucket. This wav file can be used by the Amazon Transcribe Post Call Analytics demo for further processing.

Conversely, if anyone else dials the provided number, a prompt will be played informing the caller that the call will be recorded and then the application owner is called. Once completed, this wav file will be written to the same S3 bucket as before.

This example application could be used by a jouralist to aid in interviewing people and also mask their phone number by using an Amazon Chime SIP media application number for all calls. When they need to interview a person, simply calling this number will allow them to call any number they need to and ensure the call is recorded. Additionally, when they give this number out, they will know that calls will be routed to them and also recorded.

## How It Works

### Call And Bridge

When a new call is placed to the `recordingNumber`, a check is made to determine if it is from the `sourcePhoneNumber` or any other number. If it is from the `sourcePhoneNumber` the `smaHandler` will return an action back to the SIP media application to collect digits of the phone number to dial to. If the caller is any other number, the `smaHandler` will return an action to the SIP media application to play a series of wav files, and then `CallAndBridge` to the `sourcePhoneNumber`.

```python
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
```

### Recording

This application is comprosied of several components that work together without being strictly coupled to each other. The Amazon Chime SIP media application is the main entry point in either direction and will be used for the duration of the call. This SIP media application is controlled by the `smaHandler` Lambda function using an Invocation and Action response process described [here](https://docs.aws.amazon.com/chime/latest/dg/use-cases.html). All of the call routing logic is contained within this Lambda and makes use of the [`CallAndBridge action`](https://docs.aws.amazon.com/chime/latest/dg/call-and-bridge.html) to route calls from one user to another. This Lambda also starts the recording process by directing the output to an S3 bucket with the following action:

```
const startCallRecordingAction = {
    "Type": "StartCallRecording",
    "Parameters": {
      "ParticipantTag": "LEG-B",
      "Track": "BOTH",
      "Destination": {
        "Type": "S3",
        "Location": recordingBucket + "/recordings"
      }
    }
  }
```

In this example, both call legs are being recorded and the output is being send to the previously created `recordingBucket` with a `/originalAudio` prefix. This is the default prefix used by Amazon Transcribe Post Call Analytics demo.

### Pause, Resume, Stop Recordings

The `smaHandler` also includes the ability to pause, resume, or stop the recording if the `sourcePhoneNumber` caller requests it. This will allow the owner of the number to control the recording. When the `smaHandler` Lambda is invoked with and `InvocationEventType` == `DIGITS_RECEIVED`, the below code will check to see if the invocation came from the `sourcePhoneNumber` and execute the approriate change to recording.

```python
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
```

## Cleanup

To clean up this demo: `yarn destroy`. The S3 buckets that are created will be emptied and destroyed as part of this destroy so if you wish to keep the files, they should be moved prior to destroy.
