# One service: builds the PWA, then runs FastAPI, which serves the built app at / (Step 13.2).

FROM node:22-slim AS web
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/zk/package.json packages/zk/package.json
RUN npm ci
COPY packages packages
COPY apps/web apps/web
# Empty API URL: the app calls the API on the same address it was loaded from.
ENV VITE_API_URL=""
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY apps/api/requirements.txt apps/api/requirements.txt
RUN pip install --no-cache-dir -r apps/api/requirements.txt
COPY apps/api apps/api
COPY packages/kb packages/kb
COPY scripts scripts
# Proof Pays contract addresses (pick one with CHAIN_DEPLOYMENT)
COPY contracts/deployments contracts/deployments
COPY --from=web /src/apps/web/dist apps/web/dist
RUN useradd --create-home disha && chown -R disha /app
USER disha
EXPOSE 8000
CMD ["sh", "scripts/start.sh"]
