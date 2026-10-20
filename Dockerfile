FROM python:3.12-slim-bookworm
LABEL org.opencontainers.image.source="https://github.com/eatyummydance200/library-dashboard"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home app && mkdir /app/data && chown app:app /app/data
COPY scripts/fetch-font.py ./scripts/fetch-font.py
RUN python scripts/fetch-font.py
COPY app.py schema.sql seed.json ./
COPY templates ./templates
COPY static ./static
COPY scripts/backup.py ./scripts/backup.py
USER app
EXPOSE 8000
CMD ["gunicorn", "--bind=0.0.0.0:8000", "--workers=1", "--threads=2", "--timeout=30", "--error-logfile=-", "app:create_app()"]
