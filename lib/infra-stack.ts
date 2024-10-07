import { CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Backend } from "./backend";

export interface InfraStackProps extends StackProps {
  readonly rootDomainName: string;
  readonly apiDomainPrefix: string;
  readonly hostedZoneId: string;
}

export class InfraStack extends Stack {
  public readonly clusterName: CfnOutput;
  public readonly serviceArn: CfnOutput;

  constructor(scope: Construct, id: string, props: InfraStackProps) {
    super(scope, id, props);

    const backend = new Backend(this, `${id}-Backend`, {
      rootDomainName: props.rootDomainName,
      apiDomainPrefix: props.apiDomainPrefix,
      hostedZoneId: props.hostedZoneId,
      containerProps: [{
        containerName: "exampleapi",
        containerPath: "services",
        ports: [80],
        healthCheck: {
            command: ['CMD-SHELL', 'curl -f http://localhost:80/health || exit 1']
          },
        environment: {
          plainValues: {
            EXAMPLE_API_ENV: "production",
          },
        }}],
        targetProps: [{
            containerName: "exampleapi",
            containerPort: 80,
            priority: 1,
            paths: ["/", "/health"],
        }]
    });

    this.serviceArn = backend.serviceArn;
  }
}