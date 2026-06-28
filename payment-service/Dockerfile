# Build from the repo root:  docker build -f payment-service/Dockerfile -t railbook-payment .
FROM node:20-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY shared ./shared
COPY payment-service ./payment-service
WORKDIR /app/payment-service
RUN npm install
RUN npx prisma generate
EXPOSE 4006
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
