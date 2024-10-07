#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfraStack } from '../lib/infra-stack';

const app = new cdk.App();

const backendStack = new InfraStack(app, 'InfraStack', {
  rootDomainName: '', // Replace with your domain
  apiDomainPrefix: '', // Replace with your domain prefix
  hostedZoneId: '', // Replace with your hosted zone id
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
})