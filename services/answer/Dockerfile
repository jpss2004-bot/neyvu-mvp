# Hosted answer service (D8). Build from the repository root:
#   docker build -f services/answer/Dockerfile -t neyvu-answer:dev .
# Not deployed. Configuration comes only from environment variables / secrets;
# see services/answer/answer.env.example.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/home/answer SCHOOL_ANSWER_SCRIPTS=/app/scripts
RUN useradd --create-home --home-dir /home/answer --uid 10001 answer
WORKDIR /app
COPY services/answer/requirements.txt services/answer/requirements.txt
RUN pip install --no-cache-dir -r services/answer/requirements.txt
COPY scripts/*.py scripts/
COPY services/answer/entrypoint.py services/answer/entrypoint.py
USER answer
HEALTHCHECK --interval=60s --timeout=10s CMD python services/answer/entrypoint.py --check >/dev/null || exit 1
ENTRYPOINT ["python","services/answer/entrypoint.py"]
