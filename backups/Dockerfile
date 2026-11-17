FROM postgres:18-alpine

RUN apk add --no-cache \
    bash \
    tar \
    gzip \
    rsync \
    dcron \
    curl \
    rclone

LABEL app.anishows.component="backup"

WORKDIR /app

COPY shell/ /app/shell/
COPY entrypoint.sh /app/

RUN sed -i 's/\r$//' /app/entrypoint.sh /app/shell/*.sh \
    && chmod +x /app/shell/*.sh /app/entrypoint.sh

# Create backups directory. The off-site remote is configured only through
# RCLONE_CONFIG_* variables; an empty config file stops rclone's
# "config file not found" notice on every run.
RUN mkdir -p /backups /root/.config/rclone \
    && touch /root/.config/rclone/rclone.conf

ENTRYPOINT ["/app/entrypoint.sh"]
