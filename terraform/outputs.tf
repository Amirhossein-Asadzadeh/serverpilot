# =============================================================================
# ServerPilot — Terraform Outputs
# =============================================================================

output "panel_public_ip" {
  description = "Public IP address of the ServerPilot panel (Elastic IP)"
  value       = aws_eip.panel.public_ip
}

output "panel_public_dns" {
  description = "Public DNS hostname of the panel EC2 instance"
  value       = aws_instance.panel.public_dns
}

output "panel_url" {
  description = "URL to access the ServerPilot panel"
  value       = "http://${aws_eip.panel.public_ip}"
}

output "ssh_command" {
  description = "SSH command to connect to the panel server"
  value       = "ssh -i ~/.ssh/${var.key_pair_name}.pem ubuntu@${aws_eip.panel.public_ip}"
}

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.panel.id
}

output "security_group_id" {
  description = "Security group ID for the panel"
  value       = aws_security_group.panel.id
}
