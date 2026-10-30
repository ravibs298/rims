# Build context: repository root (docker build -f frontend/Dockerfile .)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN if [ -f package-lock.json ]; then npm ci -w frontend; else npm install -w frontend; fi
COPY frontend frontend
RUN npm run build -w frontend

FROM nginx:1.27-alpine
ENV BACKEND_URL=http://rims-backend:4000
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
