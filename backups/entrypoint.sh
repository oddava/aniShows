#!/bin/bash
set -e

echo "Starting Backup Service..."

# Setup Cron Jobs
# Daily backup at 3 AM
echo "0 3 * * * /app/shell/backup.sh daily >> /var/log/cron.log 2>&1" > /etc/crontabs/root

# Weekly backup at 4 AM on Sunday
echo "0 4 * * 0 /app/shell/backup.sh weekly >> /var/log/cron.log 2>&1" >> /etc/crontabs/root

# Ensure scripts are executable
chmod +x /app/shell/*.sh

echo "Backup scheduler started."
# Start cron in foreground
crond -f -d 8
