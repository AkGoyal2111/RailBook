# Build from the repo root:  docker build -f api-gateway/Dockerfile -t railbook-gateway .
FROM node:20-slim
WORKDIR /app
COPY api-gateway ./api-gateway
WORKDIR /app/api-gateway
RUN npm install --omit=dev
EXPOSE 4000
CMD ["node", "src/index.js"]
