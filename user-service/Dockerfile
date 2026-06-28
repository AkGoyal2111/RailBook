# Build from the repo root:  docker build -f user-service/Dockerfile -t railbook-user .
FROM node:20-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY shared ./shared
COPY user-service ./user-service
WORKDIR /app/user-service
RUN npm install
RUN npx prisma generate
EXPOSE 4001
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
