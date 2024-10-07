# Web App CDK project

This is a personal CDK project.

Objective: A High level stack with a configurable interface and defaults that spawns a static front end and containerized backend.

High level services used: Cloudfront, Route53, S3, ALB, ECS (Fargate)

Highly `WIP`

Development steps:

* Cleanup Backend Construct
* Create and develop Frontend Construct
* Create and develop cdk pipelines for automation

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

The `cdk.json` file tells the CDK Toolkit how to execute your app.