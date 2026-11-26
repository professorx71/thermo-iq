# Build from the project root:  docker compose -f cloud/docker-compose.yml build
# (the compose file sets the build context to the project root)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=America/Vancouver

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# /app/app   -> server.py + static/
# /app/tools -> password helper scripts
# /app/.env and /app/data are mounted at runtime (see docker-compose.yml)
COPY app ./app
COPY tools ./tools

RUN mkdir -p /app/data

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "server:app", "--app-dir", "app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
