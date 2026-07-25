FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Pin the dependency resolver used by production builds.
RUN pip install --no-cache-dir poetry==2.4.1

# Copy dependency files
COPY pyproject.toml poetry.lock ./

# Fail if pyproject.toml and poetry.lock drift, then install the exact locked
# production dependency graph into the container environment.
RUN poetry check --lock && \
    poetry config virtualenvs.create false && \
    poetry install --no-interaction --no-ansi --only main --no-root

# Copy application code
COPY src/ ./src/

# Environment variables (Railway injects these)
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Health check port (Railway injects PORT)
EXPOSE 8080

# Entry point
CMD ["python", "-m", "src.main"]
