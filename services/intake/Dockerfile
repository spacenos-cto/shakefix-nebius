# ShakeFix intake — build context: services/intake
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app

# Install production deps only. Optional deps (firestore, web-push) are included so
# STORE=firestore / PUSH_MODE=webpush work without a rebuild; they load lazily.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
