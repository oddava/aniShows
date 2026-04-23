FROM postgres:18-alpine

RUN apk add --no-cache \
    bash \
    tar \
    gzip \
    rsync \
    dcron \
    curl

WORKDIR /app

COPY shell/ /app/shell/
COPY entrypoint.sh /app/

RUN sed -i 's/\r$//' /app/entrypoint.sh /app/shell/*.sh \
    && chmod +x /app/shell/*.sh /app/entrypoint.sh

# Create backups directory
RUN mkdir -p /backups

ENTRYPOINT ["/app/entrypoint.sh"]
