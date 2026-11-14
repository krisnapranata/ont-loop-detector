FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Jalan sebagai user biasa, bukan root. /app/data berisi pengaturan, password perangkat, dan riwayat.
RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin ontloop \
    && mkdir -p /app/data \
    && chown ontloop: /app/data
USER ontloop
VOLUME /app/data

EXPOSE 8088

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, socket; socket.create_connection(('127.0.0.1', int(os.environ.get('WEB_PORT', '8088'))), 3).close()"

CMD ["python", "-m", "app.main"]
