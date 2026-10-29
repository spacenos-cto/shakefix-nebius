# nemotron-live

Hosted, one-button demo of ShakeFix's Second Opinion on NVIDIA Nemotron via Nebius Token Factory.

Live: https://nemotron-live-pzd4uebegq-uc.a.run.app

- Runs the real double-charge case (`packages/proof/test/fixtures/b1`) through the same `labelProof()` the CI gate uses: deterministic rules first, then **one live `/chat/completions` call** to `nvidia/Nemotron-3-Ultra-550b-a55b`. Nemotron can only make a verdict stricter.
- **Hard spend cap:** each live call takes a slot from an atomic Firestore counter (`nemotronLive/counter`). After `LIVE_CAP` (30) the page shows the latest live result instead of calling the model. One call in flight at a time and one per visitor per 90 s, on a single Cloud Run instance.
- No dependencies beyond Node 22. The Nebius key comes from Secret Manager (`nebius-api-key`).

## Run locally

```bash
STORE=memory node --env-file=../../.env.nebius apps/nemotron-live/server.mjs   # http://localhost:8080
```

## Deploy (Cloud Run)

```bash
# bundle into a small Docker context
esbuild apps/nemotron-live/server.mjs --bundle --platform=node --format=esm --target=node22 \
  --outfile=stage/server.mjs --external:@playwright/test --external:pixelmatch --external:pngjs
cp apps/nemotron-live/index.html stage/ && cp -r packages/proof/test/fixtures/b1 stage/fixture
# Dockerfile: FROM node:22-slim; COPY . /app; ENV FIXTURE_DIR=/app/fixture PAGE_FILE=/app/index.html; CMD node server.mjs
gcloud run deploy nemotron-live --image <image> --max-instances 1 --no-invoker-iam-check \
  --set-env-vars MODEL_PROVIDER=openai-compatible,MODEL_BASE_URL=https://api.tokenfactory.nebius.com/v1,MODEL_NAME=nvidia/Nemotron-3-Ultra-550b-a55b,PROOF_MAX_TOKENS=8000,LIVE_CAP=30,STORE=firestore \
  --set-secrets MODEL_API_KEY=nebius-api-key:latest
```

## Rotate the Nebius key

```bash
printf %s "$NEW_KEY" | gcloud secrets versions add nebius-api-key --data-file=-
gcloud run services update nemotron-live --region us-central1 --update-secrets MODEL_API_KEY=nebius-api-key:latest
```
