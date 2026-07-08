FROM mcr.microsoft.com/playwright/python:v1.49.1-jammy

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY bot ./bot
COPY database.py .
COPY providers ./providers
COPY payments ./payments
COPY services ./services
COPY scripts ./scripts
COPY data ./data

RUN mkdir -p .data

CMD ["python", "bot/main.py"]
