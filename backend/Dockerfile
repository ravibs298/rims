# Build context: repository root (docker build -f backend/Dockerfile .)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN if [ -f package-lock.json ]; then npm ci -w backend --omit=dev; else npm install -w backend --omit=dev; fi

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN if [ -f package-lock.json ]; then npm ci -w backend; else npm install -w backend; fi
COPY backend backend
RUN npm run build -w backend

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/backend/dist backend/dist
COPY backend/migrations backend/migrations
COPY backend/package.json backend/package.json
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "backend/dist/server.js"]
