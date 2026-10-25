# SplitPal demo app. Build context: apps/splitpal
#   docker build --build-arg APP_VERSION=$CI_COMMIT_SHORT_SHA -t splitpal apps/splitpal
# To ship the ShakeFix SDK, copy packages/sdk/dist/shakefix-sdk.js to apps/splitpal/public/
# before building (the context cannot see packages/). Without it the server serves a no-op stub.

# ---- build: install all deps, run unit tests, build the front-end
FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund --loglevel=error
COPY . .
ARG APP_VERSION=dev
ARG VITE_INTAKE_URL=
ENV APP_VERSION=$APP_VERSION VITE_INTAKE_URL=$VITE_INTAKE_URL
RUN npx vite build

# ---- runtime: production deps + server + shared libs + built assets only
FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error && npm cache clean --force
COPY server ./server
COPY src/lib ./src/lib
COPY src/auth ./src/auth
COPY src/evalBugs.js ./src/evalBugs.js
COPY --from=build /app/dist ./dist
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
