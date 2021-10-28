import boto3
import time
import urllib.parse
import logging
import os

chime = boto3.client("chime")
cloudformation = boto3.resource("cloudformation")

logger = logging.getLogger()
try:
    log_level = os.environ["LogLevel"]
    if log_level not in ["INFO", "DEBUG"]:
        log_level = "INFO"
except:
    log_level = "INFO"
logger.setLevel(log_level)


def getPhoneNumber():
    search_response = chime.search_available_phone_numbers(
        # AreaCode='string',
        # City='string',
        # Country='string',
        State="IL",
        # TollFreePrefix='string',
        MaxResults=1,
    )
    phoneNumberToOrder = search_response["E164PhoneNumbers"][0]
    print("Phone Number: " + phoneNumberToOrder)
    phone_order = chime.create_phone_number_order(
        ProductType="SipMediaApplicationDialIn",
        E164PhoneNumbers=[
            phoneNumberToOrder,
        ],
    )
    print("Phone Order: " + str(phone_order))

    check_phone_order = chime.get_phone_number_order(
        PhoneNumberOrderId=phone_order["PhoneNumberOrder"]["PhoneNumberOrderId"]
    )
    order_status = check_phone_order["PhoneNumberOrder"]["Status"]
    timeout = 0

    while not order_status == "Successful":
        timeout += 1
        print("Checking status: " + str(order_status))
        time.sleep(5)
        check_phone_order = chime.get_phone_number_order(
            PhoneNumberOrderId=phone_order["PhoneNumberOrder"]["PhoneNumberOrderId"]
        )
        order_status = check_phone_order["PhoneNumberOrder"]["Status"]
        if timeout == 5:
            return "Could not get phone"

    return phoneNumberToOrder


def createSMA(region, name, lambdaArn):
    sma_create_response = chime.create_sip_media_application(
        AwsRegion=region,
        Name=name + "-SMA",
        Endpoints=[
            {"LambdaArn": lambdaArn},
        ],
    )
    print("sma create: " + str(sma_create_response))

    return sma_create_response["SipMediaApplication"]["SipMediaApplicationId"]


def createSipRule(name, phoneNumber, smaID, region):
    print(phoneNumber)
    sip_rule_response = chime.create_sip_rule(
        Name=name,
        TriggerType="ToPhoneNumber",
        TriggerValue=phoneNumber,
        Disabled=False,
        TargetApplications=[
            {"SipMediaApplicationId": smaID, "Priority": 1, "AwsRegion": region},
        ],
    )
    print("sip rule response: " + str(sip_rule_response))

    return sip_rule_response


def on_event(event, context):
    print(event)
    request_type = event["RequestType"]
    if request_type == "Create":
        return on_create(event)
    if request_type == "Update":
        return on_update(event)
    if request_type == "Delete":
        return on_delete(event)
    raise Exception("Invalid request type: %s" % request_type)


def on_create(event):
    physical_id = "smaResources"
    region = event["ResourceProperties"]["region"]
    name = event["ResourceProperties"]["smaName"]
    lambdaArn = event["ResourceProperties"]["lambdaArn"]

    newPhoneNumber = getPhoneNumber()
    smaID = createSMA(region, name, lambdaArn)
    ruleName = str(newPhoneNumber)
    sipRuleResponse = createSipRule(ruleName, newPhoneNumber, smaID, region)
    sip_rule_id = sipRuleResponse["SipRule"]["SipRuleId"]
    createSMAResponse = {"smaID": smaID, "phoneNumber": newPhoneNumber, "sip_rule_id": sip_rule_id}

    return {"PhysicalResourceId": physical_id, "Data": createSMAResponse}


def on_update(event):
    physical_id = event["PhysicalResourceId"]
    props = event["ResourceProperties"]
    print("update resource %s with props %s" % (physical_id, props))
    return {"PhysicalResourceId": physical_id}


def on_delete(event):
    physical_id = event["PhysicalResourceId"]
    stack_name = event["ResourceProperties"]["smaName"]
    stack = cloudformation.Stack(stack_name)
    outputs = {output["OutputKey"]: output["OutputValue"] for output in stack.outputs}
    phone_number = outputs["phoneNumber"]
    sma_id = outputs["smaID"]
    sip_rule_id = outputs["sipRuleID"]

    logger.info("Preparing to delete resources:")
    logger.info("Phone: {}".format(phone_number))
    logger.info("SMA ID: {}".format(sma_id))
    logger.info("SMA Rule: {}".format(sip_rule_id))

    chime.update_sip_rule(SipRuleId=sip_rule_id, Disabled=True, Name=phone_number)
    chime.delete_sip_rule(SipRuleId=sip_rule_id)
    chime.delete_sip_media_application(SipMediaApplicationId=sma_id)
    parsed_number = urllib.parse.quote_plus(phone_number)
    time.sleep(10)
    chime.delete_phone_number(PhoneNumberId=parsed_number)
    print("delete resource %s" % physical_id)

    return {"PhysicalResourceId": physical_id}
