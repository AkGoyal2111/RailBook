# Build from the repo root:  docker build -f inventory-service/Dockerfile -t railbook-inventory .
FROM node:20-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY shared ./shared
COPY inventory-service ./inventory-service
WORKDIR /app/inventory-service
RUN npm install
RUN npx prisma generate
EXPOSE 4007
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
