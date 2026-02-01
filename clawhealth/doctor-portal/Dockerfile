FROM python:3.12-slim

RUN useradd -m -s /bin/bash clawhealth
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ ./api/
COPY frontend/dist/ ./frontend/dist/

VOLUME ["/data"]
EXPOSE 5001
USER clawhealth

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5001/health')"

CMD ["gunicorn", "--bind", "0.0.0.0:5001", "--workers", "2", "--timeout", "30", "api.app:app"]
