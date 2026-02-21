# =============================================================================
# ServerPilot — Terraform Variables
# =============================================================================

variable "aws_region" {
  description = "AWS region to deploy the panel EC2 instance"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type for the panel server"
  type        = string
  default     = "t3.micro"  # 2 vCPU, 1GB RAM — sufficient for small deployments
}

variable "key_pair_name" {
  description = "Name of an existing AWS EC2 key pair for SSH access"
  type        = string
  # No default — you must provide this
}

variable "allowed_ssh_cidr" {
  description = "CIDR block allowed to SSH into the panel server (restrict to your IP)"
  type        = string
  default     = "0.0.0.0/0"  # Warning: restrict this in production
}

variable "project_name" {
  description = "Project name used for resource tagging"
  type        = string
  default     = "serverpilot"
}

variable "github_repository" {
  description = "GitHub repository in format 'org/repo' for pulling Docker images"
  type        = string
  default     = "your-org/serverpilot"
}

variable "secret_key" {
  description = "JWT secret key for the panel backend"
  type        = string
  sensitive   = true
  # Generate with: python -c "import secrets; print(secrets.token_hex(32))"
}

variable "admin_password" {
  description = "Initial password for the default admin user"
  type        = string
  sensitive   = true
}

variable "domain" {
  description = "Domain name for SSL certificate (leave empty to skip SSL)"
  type        = string
  default     = ""
}

variable "ami_id" {
  description = "AMI ID for Ubuntu 22.04 LTS (leave empty to auto-select)"
  type        = string
  default     = ""  # Will use data source to find latest if empty
}
