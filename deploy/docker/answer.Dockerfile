# syntax=docker/dockerfile:1.7
# Neyvu answer service: scripts/beta_ai_worker.py and the helpers it imports.
# Build from the repository root:
#   docker build -f deploy/docker/answer.Dockerfile -t neyvu-answer .
#   docker build -f deploy/docker/answer.Dockerfile --build-arg INSTALL_HEAVY=1 -t neyvu-answer:heavy .
#
# The worker has no database access: it leases jobs over HTTPS from the web service
# (/api/beta/worker) with SCHOOL_BETA_WORKER_KEY, injected at runtime only.
# Model provider (runtime env, read by scripts/model_provider.py):
#   SCHOOL_BETA_MODEL_PROVIDER=ollama     local model at 127.0.0.1:11435 (sidecar in the
#                                         same task / pod; awsvpc shares loopback)
#   SCHOOL_BETA_MODEL_PROVIDER=anthropic  hosted provider; ANTHROPIC_API_KEY from secrets.
#                                         Falls back to the local endpoint on failure.
# KNOWN GAP: the worker hard-codes ORIGIN=https://neyvu-app.example.com.
# It must read SCHOOL_BETA_ORIGIN before this image can serve the AWS deployment.

FROM python:3.12-slim-bookworm
ARG INSTALL_HEAVY=0
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    HOME=/home/worker \
    SCHOOL_EXTRACT_PYTHON=/usr/local/bin/python3 \
    SCHOOL_BETA_MODEL_PROVIDER=ollama
RUN groupadd --system --gid 10001 worker \
 && useradd --system --uid 10001 --gid worker --home-dir /home/worker --create-home --shell /usr/sbin/nologin worker
WORKDIR /app
COPY deploy/docker/answer-requirements.txt deploy/docker/answer-requirements-heavy.txt ./
RUN pip install --no-cache-dir -r answer-requirements.txt \
 && if [ "$INSTALL_HEAVY" = "1" ]; then pip install --no-cache-dir -r answer-requirements-heavy.txt; fi
# Import closure of beta_ai_worker.py plus the helper scripts it launches by path.
COPY scripts/beta_ai_worker.py scripts/assignment_coaching.py scripts/assistant_language.py \
     scripts/bounded_process.py scripts/citecheck.py scripts/claimguard.py \
     scripts/class_cornell_anchors.py scripts/class_cornell_reader.py scripts/class_speech_worker.py \
     scripts/class_speech_section.py scripts/class_transcribe.py scripts/continuity_scope.py \
     scripts/dateguard.py scripts/document_reader.py scripts/docling_pdf.py scripts/draft_review.py \
     scripts/evidenceguard.py scripts/excerpt_scope.py scripts/extract_legacy_ppt.py scripts/extract_pdf.py \
     scripts/featured_writing.py scripts/generation_health.py scripts/group_attribution.py \
     scripts/inference_transport.py scripts/injectionguard.py scripts/learning_support.py \
     scripts/mathcheck.py scripts/mathcheck_cli.py scripts/model_provider.py scripts/offline_ocr.py \
     scripts/planning_steps.py scripts/preparation.py scripts/preparation_draft.py \
     scripts/returned_feedback.py scripts/source_evidence_reader.py scripts/source_profile_reader.py \
     scripts/source_teaching.py scripts/workguard.py \
     ./scripts/
COPY --chmod=755 deploy/docker/answer-entrypoint.sh /usr/local/bin/answer-entrypoint
RUN python3 -m compileall -q /app/scripts && chown -R root:root /app && chmod -R a-w /app
USER worker
# Liveness: the worker process is running (it exposes no port; readiness is the web
# service's worker heartbeat in /api/beta/health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD grep -q beta_ai_worker /proc/1/cmdline
ENTRYPOINT ["/usr/local/bin/answer-entrypoint"]
