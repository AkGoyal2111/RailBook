# Build from the repo root:  docker build -f admin-service/Dockerfile -t railbook-admin .
FROM node:20-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY shared ./shared
COPY admin-service ./admin-service
WORKDIR /app/admin-service
RUN npm install
RUN npx prisma generate
EXPOSE 4003
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
