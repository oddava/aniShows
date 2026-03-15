FROM postgres:18-alpine

RUN apk add --no-cache \
    bash \
    tar \
    gzip \
    dcron \
    curl

WORKDIR /app

COPY shell/ /app/shell/
COPY entrypoint.sh /app/

RUN chmod +x /app/shell/*.sh /app/entrypoint.sh

# Create backups directory
RUN mkdir -p /backups

ENTRYPOINT ["/app/entrypoint.sh"]
