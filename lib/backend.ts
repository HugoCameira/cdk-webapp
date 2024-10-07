import { CfnOutput, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import { DnsValidatedCertificate } from "aws-cdk-lib/aws-certificatemanager";
import {
    InstanceClass,
    InstanceSize,
    InstanceType,
    IVpc,
    Port,
    SecurityGroup,
    Vpc,
  } from "aws-cdk-lib/aws-ec2";
import {
    AwsLogDriver,
    Cluster,
    ContainerDefinition,
    ContainerDependency,
    ContainerImage,
    FargateTaskDefinition,
    Secret,
    HealthCheck,
    ContainerDependencyCondition,
  } from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancedFargateService, ApplicationMultipleTargetGroupsFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import {
    ApplicationProtocol,
    ApplicationProtocolVersion,
    ApplicationTargetGroup,
    ListenerAction,
    TargetType,
    Protocol,
    ListenerCondition,
    ApplicationListener,
  } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {
    Effect,
    ManagedPolicy,
    PolicyStatement,
    Role,
    ServicePrincipal,
  } from "aws-cdk-lib/aws-iam";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import path = require("path");

interface BackendProps {
    rootDomainName: string;
    apiDomainPrefix: string;
    containerProps: ContainerProps[];
    targetProps: TargetProps[];
  }

interface ContainerProps {
    containerName: string;
    dependencies?: ContainerDependency[];
    containerPath: string;
    healthCheck?: HealthCheck;
    ports: number[];
    //task: FargateTaskDefinition;
    //vpc: IVpc;
    environment: {
      plainValues: Record<string, string>;
    };
}

export interface TargetProps {
    containerName: string;
    containerPort: number;
    priority: number;
    paths: string[];
    healthCheckPath?: string;
  }

export class Backend extends Construct {
    public readonly clusterName: CfnOutput;
    public readonly serviceArn: CfnOutput;
    constructor(scope: Construct, id: string, props: BackendProps) {
      super(scope, id);
    

     // Create task definition
     const taskRole = new Role(scope, `${id}ECSTaskRole`, {
        assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      });
  
      const executionRole = new Role(scope, `${id}ECSExecutionRole`, {
        assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      });
      executionRole.addManagedPolicy(
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        )
      );

      const task = new FargateTaskDefinition(scope, `${id}ECSTask`, {
        executionRole,
        taskRole,
      });

      const vpc = new Vpc(scope, `${id}ECSLoadBalancerVpc`, {
        maxAzs: 2, // Default is all AZs in region, at least 2 required for LB
        natGateways: 1, // We need at least 1 NAT gateway to get outbound internet access from agency
      });

      const apiAddress = `${props.apiDomainPrefix}.${props.rootDomainName}`;

      props.containerProps.forEach(element => {
        this.addContainer(element,task);
      });

      const zone = HostedZone.fromLookup(this, `${id}HostedZone`, {
        domainName: props.rootDomainName,
      });
  
      const certificate = new DnsValidatedCertificate(scope, `${id}Certificate`, {
        domainName: '*.${props.rootDomainName}',
        hostedZone: zone,

      });
  
      const cluster = new Cluster(scope, `${id}ECSCluster`, {
        vpc,
      });

      const lbService = new ApplicationLoadBalancedFargateService(
        scope,
        `${id}Service`,
        {
          cluster,
          cpu: 256,
          desiredCount: 1,
          taskDefinition: task,
          memoryLimitMiB: 1024,
          protocol: ApplicationProtocol.HTTPS,
          redirectHTTP: true,
          certificate: certificate,
          domainName: apiAddress,
          domainZone: zone,
        }
      );

      lbService.targetGroup.configureHealthCheck({
        path: "/health"
      })

      const loadBalancer = lbService.loadBalancer;

      /*new ARecord(scope, `${id}ARecord`, {
        recordName: apiAddress,
        target: RecordTarget.fromAlias(new LoadBalancerTarget(loadBalancer)),
        zone,
      });

       const httpListner = loadBalancer.addListener('http-listner', {
        port: 80,
        protocol: ApplicationProtocol.HTTP,
        defaultAction: ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true
        })
      })
  
      const httpsListener = loadBalancer.addListener('https-listener', {
        port: 443,
        protocol: ApplicationProtocol.HTTPS,
        certificates: [certificate],
        defaultAction: ListenerAction.fixedResponse(403, {
          contentType: 'text/plain',
          messageBody: 'Forbidden - Missing or Invalid CloudFront Token'
        })
      }) */

      const httpsListener = lbService.listener
/*
      httpsListener.addAction('default', {
        action: ListenerAction.fixedResponse(403, {
          contentType: 'text/plain',
          messageBody: 'Forbidden - Missing or Invalid CloudFront Token'
        })
      })

       props.targetProps.forEach(targetProp => {
        this.addHttpsTarget(`${id}-${targetProp.containerName}`,httpsListener,lbService,{
            priority: targetProp.priority,
            containerName: targetProp.containerName,
            containerPort: targetProp.containerPort,
            paths: targetProp.paths
          })
      }); */

      this.clusterName = new CfnOutput(this, "ClusterName", {
        value: cluster.clusterName,
      });
      this.serviceArn = new CfnOutput(this, "ServiceArn", {
        value: lbService.service.serviceArn,
      });
    }

    addContainer(props: ContainerProps,task: FargateTaskDefinition): ContainerDefinition{
        const {
          containerName,
          containerPath,
          environment,
          healthCheck,
          ports,
        } = props;
    
        // Create container with environment variables, port configurations etc.
        const container = task.addContainer(containerName, {
          image: ContainerImage.fromAsset(path.join(__dirname, '..', containerPath)),
          environment: environment.plainValues,
          logging: new AwsLogDriver({
            streamPrefix: containerName,
            logRetention: RetentionDays.ONE_MONTH,
          }),
          healthCheck,
          portMappings: ports.map((containerPort) => ({ containerPort })),
        });
    
        return container
    }

    addHttpsTarget(
        id: string,
        httpsListener: ApplicationListener,
        service: ApplicationLoadBalancedFargateService,
        props: TargetProps
      ): void {
        const {
          containerName,
          containerPort,
          priority,
          paths,
          healthCheckPath,
        } = props;
        const fgService = service.service;
        httpsListener.addTargets(`${id}ECSHTTPSTarget`, {
          protocol: ApplicationProtocol.HTTP,
          port: containerPort,
          priority,
          conditions: [ListenerCondition.pathPatterns(paths)/*ListenerCondition.httpHeader('X-Cf-Token', [secret])*/],
          targets: [
            fgService.loadBalancerTarget({
              containerName,
              containerPort,
            }),
          ],
          healthCheck: {
            port: containerPort.toString(),
            protocol: Protocol.HTTP,
            path: healthCheckPath != null ? healthCheckPath : "/",
          },
        });
    
        fgService.connections.allowFrom(service.loadBalancer, Port.tcp(443));
        service.loadBalancer.connections.allowTo(
          fgService,
          Port.tcp(containerPort)
        );
      }
}