# ShakeFix intake for non-GitLab ports (SCM_PROVIDER=github). Build context: the REPO ROOT,
# because the GitHub provider lives in packages/core (the default GitLab image in
# services/intake/Dockerfile only needs services/intake).
#   gcloud builds submit . --config infra/cloudbuild.yaml \
#     --substitutions=_IMAGE=<ar image>,_DOCKERFILE=templates/github/intake.Dockerfile,_CONTEXT=.,_SA=<sa>
# services/intake/src/scm.js loads ../../../packages/core/src/scm/index.js, so keep this layout.
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080 \
    SCM_PROVIDER=github

WORKDIR /app/services/intake
COPY services/intake/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY packages/core/package.json /app/packages/core/package.json
COPY packages/core/src /app/packages/core/src
COPY services/intake/src ./src

USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
