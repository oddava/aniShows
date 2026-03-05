output "alb_dns_name" {
  description = "Public DNS of the application load balancer"
  value       = aws_lb.app.dns_name
}

output "target_group_arn" {
  description = "ALB target group ARN used for health-checked traffic"
  value       = aws_lb_target_group.web.arn
}

output "asg_name" {
  description = "Auto Scaling Group name"
  value       = aws_autoscaling_group.app.name
}

output "rds_primary_endpoint" {
  description = "Primary RDS endpoint"
  value       = aws_db_instance.primary.endpoint
}

output "rds_read_replica_endpoint" {
  description = "Read replica endpoint"
  value       = aws_db_instance.read_replica.endpoint
}

output "redis_primary_endpoint" {
  description = "ElastiCache primary endpoint"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_reader_endpoint" {
  description = "ElastiCache reader endpoint"
  value       = aws_elasticache_replication_group.redis.reader_endpoint_address
}

output "cloudfront_domain_name" {
  description = "CloudFront domain for CDN delivery"
  value       = aws_cloudfront_distribution.assets.domain_name
}
