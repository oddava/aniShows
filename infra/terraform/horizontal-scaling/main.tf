locals {
  prefix = var.project_name
  tags = {
    Project   = var.project_name
    ManagedBy = "terraform"
  }
}

resource "aws_lb" "app" {
  name               = "${local.prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids

  tags = local.tags
}

resource "aws_lb_target_group" "web" {
  name        = "${local.prefix}-web-tg"
  port        = 8000
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = var.vpc_id

  health_check {
    enabled             = true
    path                = "/api/v1/health/"
    protocol            = "HTTP"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 15
  }

  tags = local.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_launch_template" "app" {
  name_prefix   = "${local.prefix}-app-"
  image_id      = var.ami_id
  instance_type = var.instance_type

  vpc_security_group_ids = [var.app_security_group_id]
  user_data              = base64encode(var.user_data)

  tag_specifications {
    resource_type = "instance"
    tags          = merge(local.tags, { Name = "${local.prefix}-app" })
  }

  tags = local.tags
}

resource "aws_autoscaling_group" "app" {
  name                = "${local.prefix}-asg"
  vpc_zone_identifier = var.private_subnet_ids
  min_size            = var.min_size
  max_size            = var.max_size
  desired_capacity    = var.desired_capacity
  health_check_type   = "ELB"
  health_check_grace_period = 120

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  target_group_arns = [aws_lb_target_group.web.arn]

  tag {
    key                 = "Name"
    value               = "${local.prefix}-app"
    propagate_at_launch = true
  }

  dynamic "tag" {
    for_each = local.tags
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = true
    }
  }
}

resource "aws_autoscaling_policy" "cpu_target" {
  name                   = "${local.prefix}-cpu-target"
  autoscaling_group_name = aws_autoscaling_group.app.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 60
  }
}

resource "aws_autoscaling_policy" "alb_requests" {
  name                   = "${local.prefix}-alb-requests"
  autoscaling_group_name = aws_autoscaling_group.app.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.app.arn_suffix}/${aws_lb_target_group.web.arn_suffix}"
    }
    target_value = 600
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.prefix}-db-subnet-group"
  subnet_ids = var.private_subnet_ids
  tags       = local.tags
}

resource "aws_db_instance" "primary" {
  identifier             = "${local.prefix}-db-primary"
  engine                 = "postgres"
  engine_version         = "17.4"
  instance_class         = "db.t4g.medium"
  allocated_storage      = 100
  max_allocated_storage  = 500
  storage_encrypted      = true
  multi_az               = true
  db_name                = var.db_name
  username               = var.db_username
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.db_security_group_id]
  backup_retention_period = 7
  skip_final_snapshot    = true
  deletion_protection    = true
  publicly_accessible    = false

  tags = local.tags
}

resource "aws_db_instance" "read_replica" {
  identifier             = "${local.prefix}-db-replica-1"
  replicate_source_db    = aws_db_instance.primary.identifier
  instance_class         = "db.t4g.medium"
  publicly_accessible    = false
  auto_minor_version_upgrade = true
  vpc_security_group_ids = [var.db_security_group_id]
  skip_final_snapshot    = true

  tags = local.tags
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.prefix}-redis-subnet-group"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${local.prefix}-redis"
  description                = "Redis HA for ${var.project_name}"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = "cache.t4g.small"
  parameter_group_name       = "default.redis7"
  port                       = 6379
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [var.cache_security_group_id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = local.tags
}

resource "aws_cloudfront_distribution" "assets" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  aliases             = [var.domain_name]

  origin {
    domain_name = var.origin_host
    origin_id   = "${local.prefix}-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "${local.prefix}-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Origin", "Accept", "Authorization"]

      cookies {
        forward = "all"
      }
    }

    min_ttl     = 0
    default_ttl = 300
    max_ttl     = 31536000
  }

  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    target_origin_id       = "${local.prefix}-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 3600
    default_ttl = 86400
    max_ttl     = 31536000
  }

  ordered_cache_behavior {
    path_pattern           = "/media/*"
    target_origin_id       = "${local.prefix}-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    forwarded_values {
      query_string = true
      headers      = ["Origin"]
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 300
    default_ttl = 86400
    max_ttl     = 31536000
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = local.tags
}
