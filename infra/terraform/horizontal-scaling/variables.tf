variable "aws_region" {
  type        = string
  description = "AWS region for aniShows infrastructure"
}

variable "project_name" {
  type        = string
  description = "Project prefix for resource names"
  default     = "anishows"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID where all resources will be provisioned"
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnet IDs for ALB"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for app, RDS, and ElastiCache"
}

variable "alb_security_group_id" {
  type        = string
  description = "Security group ID for ALB"
}

variable "app_security_group_id" {
  type        = string
  description = "Security group ID for app instances"
}

variable "db_security_group_id" {
  type        = string
  description = "Security group ID for RDS"
}

variable "cache_security_group_id" {
  type        = string
  description = "Security group ID for Redis/ElastiCache"
}

variable "ami_id" {
  type        = string
  description = "AMI for application instances"
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type for app nodes"
  default     = "c7g.large"
}

variable "desired_capacity" {
  type        = number
  description = "ASG desired instance count"
  default     = 6
}

variable "min_size" {
  type        = number
  description = "ASG minimum size"
  default     = 4
}

variable "max_size" {
  type        = number
  description = "ASG maximum size"
  default     = 60
}

variable "default_instance_warmup" {
  type        = number
  description = "ASG warmup period in seconds"
  default     = 90
}

variable "asg_cpu_target_percent" {
  type        = number
  description = "Target CPU utilization for target-tracking policy"
  default     = 55
}

variable "asg_requests_per_target" {
  type        = number
  description = "Target ALB requests/target for target-tracking policy"
  default     = 1000
}

variable "domain_name" {
  type        = string
  description = "Primary domain used by CloudFront"
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN for CloudFront"
}

variable "origin_host" {
  type        = string
  description = "Origin host name for CloudFront (ALB DNS or Caddy domain)"
}

variable "db_name" {
  type        = string
  description = "RDS primary database name"
  default     = "anishows"
}

variable "db_instance_class" {
  type        = string
  description = "RDS primary instance class"
  default     = "db.r7g.large"
}

variable "db_replica_instance_class" {
  type        = string
  description = "RDS read replica instance class"
  default     = "db.r7g.large"
}

variable "db_allocated_storage" {
  type        = number
  description = "Allocated storage for primary RDS instance (GiB)"
  default     = 200
}

variable "db_max_allocated_storage" {
  type        = number
  description = "Max autoscaling storage for primary RDS instance (GiB)"
  default     = 2000
}

variable "db_username" {
  type        = string
  description = "RDS master username"
  default     = "anishows"
}

variable "db_password" {
  type        = string
  description = "RDS master password"
  sensitive   = true
}

variable "redis_node_type" {
  type        = string
  description = "ElastiCache node type"
  default     = "cache.r7g.large"
}

variable "redis_engine_version" {
  type        = string
  description = "ElastiCache Redis engine version"
  default     = "7.1"
}

variable "redis_num_cache_clusters" {
  type        = number
  description = "Number of cache nodes in replication group"
  default     = 3
}

variable "user_data" {
  type        = string
  description = "Bootstrap user-data script for app instances"
  default     = "#!/bin/bash\nset -e\n"
}
