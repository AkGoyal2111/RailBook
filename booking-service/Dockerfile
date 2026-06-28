# Build from the repo root:  docker build -f booking-service/Dockerfile -t railbook-booking .
FROM node:20-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY shared ./shared
COPY booking-service ./booking-service
WORKDIR /app/booking-service
RUN npm install
RUN npx prisma generate
EXPOSE 4005
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
