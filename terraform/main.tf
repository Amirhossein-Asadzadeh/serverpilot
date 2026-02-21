# =============================================================================
# ServerPilot — Terraform Infrastructure (AWS EC2)
# =============================================================================
#
# Deploys the ServerPilot panel to an AWS EC2 instance.
# The user_data script auto-installs Docker and starts all services.
#
# Usage:
#   terraform init
#   terraform plan -var="key_pair_name=my-key" -var="secret_key=..." -var="admin_password=..."
#   terraform apply

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment to use S3 remote state (recommended for teams)
  # backend "s3" {
  #   bucket = "your-terraform-state-bucket"
  #   key    = "serverpilot/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.project_name
      ManagedBy   = "terraform"
      Environment = "production"
    }
  }
}

# ─── Data Sources ─────────────────────────────────────────────────────────────

# Find latest Ubuntu 22.04 LTS AMI in the selected region
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]  # Canonical's AWS account ID

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ─── Networking ───────────────────────────────────────────────────────────────

# Use the default VPC for simplicity (create a custom VPC for production)
data "aws_vpc" "default" {
  default = true
}

# ─── Security Group ───────────────────────────────────────────────────────────

resource "aws_security_group" "panel" {
  name        = "${var.project_name}-panel"
  description = "ServerPilot panel security group"
  vpc_id      = data.aws_vpc.default.id

  # SSH access (restrict to your IP in production!)
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }

  # HTTP
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # All outbound traffic (needed for Docker pulls, apt updates, agent pings)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-panel-sg"
  }
}

# ─── EC2 Instance ─────────────────────────────────────────────────────────────

resource "aws_instance" "panel" {
  ami           = var.ami_id != "" ? var.ami_id : data.aws_ami.ubuntu.id
  instance_type = var.instance_type
  key_name      = var.key_pair_name

  vpc_security_group_ids = [aws_security_group.panel.id]

  # Root volume: 20GB gp3 is sufficient for the panel + SQLite
  root_block_device {
    volume_type           = "gp3"
    volume_size           = 20
    delete_on_termination = true
    encrypted             = true
  }

  # Cloud-init user data: installs Docker, clones repo, starts services
  user_data = base64encode(templatefile("${path.module}/user_data.sh.tpl", {
    project_name      = var.project_name
    github_repository = var.github_repository
    secret_key        = var.secret_key
    admin_password    = var.admin_password
    domain            = var.domain
  }))

  # Required for IMDSv2 (AWS security best practice)
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"  # IMDSv2 only
    http_put_response_hop_limit = 1
  }

  tags = {
    Name = "${var.project_name}-panel"
  }
}

# ─── Elastic IP ───────────────────────────────────────────────────────────────

resource "aws_eip" "panel" {
  instance = aws_instance.panel.id
  domain   = "vpc"

  tags = {
    Name = "${var.project_name}-panel-eip"
  }
}
