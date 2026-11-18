# Hosted answer service (D8, 2026-11-12) — packaged, not deployed

The answer worker (`scripts/beta_ai_worker.py`) in a container. It polls the web
app for answer jobs exactly as on the Mac mini. All guards run on every answer
whichever model wrote it.

- Model: `SCHOOL_BETA_MODEL_PROVIDER=anthropic` uses Claude Haiku through the existing
  `scripts/model_provider.py` switch. Set `SCHOOL_ANSWER_OLLAMA_URL` to keep a local model as fallback.
- Config: environment variables only (`answer.env.example`). The worker key is written to a 0600 file inside the container.
- `python services/answer/entrypoint.py --check` validates the config and makes no network calls. It also serves as the container health check.

```sh
docker build -f services/answer/Dockerfile -t neyvu-answer:dev .
docker run --rm --network none --env-file services/answer/answer.env.example neyvu-answer:dev --check
```

Before any real run, BUILD-PLAN D8 needs: F1 consent and privacy disclosures, an owner-supplied
API key, a full bank rerun on Haiku, and owner approval to deploy.
