# Horizontal Scaling Stack

This Terraform stack provisions the core infrastructure required to run aniShows beyond a single EC2 node:

- ALB + target group health checks on `/api/v1/health/`
- EC2 Auto Scaling Group with target-tracking policies
- RDS PostgreSQL primary + read replica
- ElastiCache Redis replication group (Multi-AZ failover)
- CloudFront distribution for static/media CDN delivery

Defaults in this stack are tuned for high concurrency and should still be validated under your real traffic patterns before full production rollout.

## Usage

1. Create `terraform.tfvars` in this directory.
2. Fill all required variables.
3. Run Terraform:

```bash
terraform init
terraform plan
terraform apply
```

## Minimal `terraform.tfvars` example

```hcl
aws_region              = "us-east-1"
project_name            = "anishows"
vpc_id                  = "vpc-xxxx"
public_subnet_ids       = ["subnet-public-a", "subnet-public-b"]
private_subnet_ids      = ["subnet-private-a", "subnet-private-b"]
alb_security_group_id   = "sg-alb"
app_security_group_id   = "sg-app"
db_security_group_id    = "sg-db"
cache_security_group_id = "sg-cache"
ami_id                  = "ami-xxxxxxxx"
domain_name             = "cdn.anishows.com"
acm_certificate_arn     = "arn:aws:acm:us-east-1:123456789012:certificate/xxxx"
origin_host             = "app.anishows.com"
db_password             = "replace-me"
instance_type           = "c7g.large"
desired_capacity        = 6
min_size                = 4
max_size                = 60
default_instance_warmup = 90
asg_cpu_target_percent  = 55
asg_requests_per_target = 1000
db_instance_class       = "db.r7g.large"
db_replica_instance_class = "db.r7g.large"
db_allocated_storage    = 200
db_max_allocated_storage = 2000
redis_node_type         = "cache.r7g.large"
redis_num_cache_clusters = 3

user_data = <<-EOT
#!/bin/bash
set -e
echo "bootstrap app host"
EOT
```

## App config alignment

After applying this stack, set application env vars to use the managed services:

- `DB_ENABLE_READ_REPLICA_ROUTING=True`
- `DB_REPLICA_HOSTS=<read-replica-endpoint>`
- `REDIS_HOST=<elasticache-primary-endpoint>` (or Sentinel/cluster topology)
- `CDN_BASE_URL=https://cdn.anishows.com`
- `STATIC_CDN_URL=https://cdn.anishows.com`
- `MEDIA_CDN_URL=https://cdn.anishows.com`

For ASG nodes, use queue-specific worker instance groups where needed:

- web ASG for `web` + `daphne`
- worker ASG for `celery` + `celery_priority`
- media ASG for `celery_images`
- analytics ASG for `celery_analytics`

## Throughput Validation

For 100k+ active-user targets, run staged tests before production cutover:

1. Baseline: 5k-10k concurrent users.
2. Scale stages: 25k, 50k, and 100k with SLO checks on each stage.
3. Validate autoscaling reaction time, DB/Redis headroom, and websocket stability.
4. Roll out with canary traffic and rollback triggers.
