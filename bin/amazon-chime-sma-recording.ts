#!/usr/bin/env node
import * as cdk from "@aws-cdk/core";
import { AmazonChimeSmaRecording } from "../lib/amazon-chime-sma-recording-stack";

const app = new cdk.App();

new AmazonChimeSmaRecording(app, "AmazonChimeSmaRecording", {});

app.synth();
