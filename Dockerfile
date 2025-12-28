FROM python:3.12-slim

RUN useradd -m aniuser

WORKDIR /app

RUN apt-get update && apt-get install -y python3-pip curl && apt-get clean

RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

RUN pip install uv
RUN pip install honcho

COPY pyproject.toml .

RUN uv sync

COPY . .

RUN chown -R aniuser:aniuser /app

USER aniuser

EXPOSE 8000

CMD ["uv", "run", "python", "manage.py", "runserver", "0.0.0.0:8000"]