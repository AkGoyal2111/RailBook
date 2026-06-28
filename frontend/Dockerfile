# Build from the repo root:  docker build -f frontend/Dockerfile -t railbook-frontend .
# Stage 1 — build the static site
FROM node:20-slim AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend ./
RUN npm run build

# Stage 2 — serve with nginx (also proxies /api to the gateway)
FROM nginx:alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
