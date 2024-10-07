import { CfnOutput, Duration, aws_cloudfront_origins, aws_route53_targets } from "aws-cdk-lib";
import { Construct } from "constructs";
import { DnsValidatedCertificate, Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { IOrigin, Distribution, CachePolicy, AllowedMethods, OriginRequestPolicy, ViewerProtocolPolicy, OriginProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { IVpc, Vpc, SubnetType} from "aws-cdk-lib/aws-ec2";
import {FargateService, Cluster, ContainerDependency, ContainerImage, FargateTaskDefinition, Secret, HealthCheck, LogDrivers } from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancer, ListenerCertificate, ApplicationProtocol, ListenerAction, ListenerCondition} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { RetentionDays, LogGroup } from "aws-cdk-lib/aws-logs";
import { ARecord, HostedZone, RecordTarget, IHostedZone } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import * as crypto from 'crypto';
import path = require("path");

interface BackendProps {
    rootDomainName: string;
    apiDomainPrefix: string;
    hostedZoneId: string;
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
    public readonly serviceArn: CfnOutput;

    private id: string;
    private vpc: Vpc
    private secret: string

    constructor(scope: Construct, id: string, props: BackendProps) {
      super(scope, id);
      
      this.id = id;
      this.vpc = this.addVpc()
      this.secret = this.createCloudFrontToken()
      const hostedZone = this.addHostedZone(props)
      const lbService = this.addECSService(this.vpc)
      const lb = this.addLoadBalancer(this.vpc, hostedZone, lbService, this.secret, props)
      this.addCloudFront(lb, hostedZone, this.secret, props)

      const apiAddress = `${props.apiDomainPrefix}.${props.rootDomainName}`;

      this.serviceArn = new CfnOutput(this, "ServiceArn", {
        value: lbService.serviceArn,
      });
    }

      private addVpc (): Vpc {
        const vpc = new Vpc(this, `${this.id}-ECSLoadBalancerVpc`, {
          maxAzs: 2,
          natGateways: 1, // https://www.lastweekinaws.com/blog/the-aws-managed-nat-gateway-is-unpleasant-and-not-recommended/ :)
        })
    
        return vpc
      }

      private addECSService (vpc: IVpc): FargateService {
        const cluster = new Cluster(this, `${this.id}-Cluster`, {
          vpc: vpc,
          containerInsights: true
        })

        const taskDefinition = new FargateTaskDefinition(this, `${this.id}-taskdef`, {
          memoryLimitMiB: 512,
          cpu: 256
          // add roles here for db access, etc
        })
    
        const logGroup = new LogGroup(this, `${this.id}-container-log-group`, {
          retention: RetentionDays.ONE_WEEK,
        });
    
        taskDefinition.addContainer(`${this.id}-web`, {
          image: ContainerImage.fromAsset(path.join(__dirname, '..', 'services')),
          memoryLimitMiB: 512,
          cpu: 256,
          portMappings: [{
            containerPort: 80,
            hostPort: 80
          }],
          logging: LogDrivers.awsLogs({
            streamPrefix: 'ecs',
            logGroup: logGroup,
          }),
          healthCheck: {
            command: ['CMD-SHELL', 'curl -f http://localhost:80/health || exit 1'],
            interval: Duration.seconds(30),
            timeout: Duration.seconds(5),
            retries: 3,
            startPeriod: Duration.seconds(60),
          },
        })

        const service = new FargateService(this, `${this.id}-fargate-service`, {
          cluster: cluster,
          taskDefinition: taskDefinition,
          desiredCount: 1,
          maxHealthyPercent: 200,
          minHealthyPercent: 50,
          assignPublicIp: true,
          vpcSubnets: {
            subnetType: SubnetType.PRIVATE_WITH_EGRESS
          }
        })

        return service
      }

      private addLoadBalancer (vpc: Vpc, hostedZone: IHostedZone, service: FargateService, secret: string, props: BackendProps): ApplicationLoadBalancer {
        const lb = new ApplicationLoadBalancer(this, `${this.id}-loadbalancer`, {
          vpc: vpc,
          internetFacing: true,
        })

        const certificate = new DnsValidatedCertificate(this, `${this.id}-loadbalancer-certificate`, {
          domainName: `*.${props.rootDomainName}`,
          hostedZone: hostedZone,
          region: 'eu-west-1'
        })
    
        const loadBalancerARecord = new ARecord(this, `${this.id}-lb-a-record`, {
          zone: hostedZone,
          target: RecordTarget.fromAlias(new LoadBalancerTarget(lb)),
          recordName: `${props.apiDomainPrefix}lb.${props.rootDomainName}`
        })

        const httpListner = lb.addListener(`${this.id}-http-listner`, {
          port: 80,
          protocol: ApplicationProtocol.HTTP,
          defaultAction: ListenerAction.redirect({
            protocol: 'HTTPS',
            port: '443',
            permanent: true
          })
        })
    
        const httpsListener = lb.addListener(`${this.id}-https-listener`, {
          port: 443,
          protocol: ApplicationProtocol.HTTPS,
          certificates: [ListenerCertificate.fromCertificateManager(certificate)],
          defaultAction: ListenerAction.fixedResponse(403, {
            contentType: 'text/plain',
            messageBody: 'Forbidden - Missing or Invalid CloudFront Token'
          })
        })

        httpsListener.addTargets(`${this.id}-target-group`, {
          priority: 1,
          port: 80,
          targets: [service],
          healthCheck: {
            path: '/health', // Specify the health check endpoint path
            interval: Duration.seconds(30), // Health check interval
            timeout: Duration.seconds(5), // Health check timeout
            healthyThresholdCount: 2, // Number of consecutive successful health checks to consider the target healthy
            unhealthyThresholdCount: 2, // Number of consecutive failed health checks to consider the target unhealthy
          },
          conditions: [ListenerCondition.httpHeader('X-Cf-Token', [secret])]
        })
    
        return lb
      }

      private addHostedZone (props: BackendProps): IHostedZone {
        const hostedZone = HostedZone.fromHostedZoneAttributes(this, `${this.id}-hosted-zone`, {
          hostedZoneId: props.hostedZoneId,
          zoneName: props.rootDomainName
        })
    
        return hostedZone
      }

      private addCloudFront(lb: ApplicationLoadBalancer, hostedZone: IHostedZone, secret: string, props: BackendProps): Distribution {

        const cloudFrontCertificate = new DnsValidatedCertificate(this, `${this.id}-cloudfront-certificate`, {
          domainName: `*.${props.rootDomainName}`,
          hostedZone: hostedZone,
          region: 'us-east-1'
        })

        const elbOrigin = new aws_cloudfront_origins.LoadBalancerV2Origin(lb, {
          protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
          customHeaders: {"X-Cf-Token": secret}
        })

        const cfDistribution = new Distribution(this, `${this.id}-distribution`, {
          defaultBehavior: {
              origin: elbOrigin,
              cachePolicy: CachePolicy.CACHING_DISABLED,
              allowedMethods: AllowedMethods.ALLOW_ALL,
              viewerProtocolPolicy: ViewerProtocolPolicy.ALLOW_ALL,
              originRequestPolicy: OriginRequestPolicy.ALL_VIEWER,
          },
          enableLogging: true,
          domainNames: [`${props.apiDomainPrefix}.${props.rootDomainName}`],
          certificate: cloudFrontCertificate
        })

        const cfARecord = new ARecord(this, `${this.id}-a-record`, {
          zone: hostedZone,
          target: RecordTarget.fromAlias(new aws_route53_targets.CloudFrontTarget(cfDistribution)),
          recordName: `${props.apiDomainPrefix}.${props.rootDomainName}`,
        })
    
      return cfDistribution
      }

      //TODO: change this to secret manager
      private createCloudFrontToken(): string {
        return crypto.randomBytes(32).toString('hex').slice(0, 32);
      }
}