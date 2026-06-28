const config = {
  SERVICE_NAME: require('../../package.json').name,
  PORT: Number(process.env.PORT) || 4001,
  NODE_ENV: process.env.NODE_ENV || "development",
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,

  OTP_TTL: process.env.OTP_TTL || 300,
  OTP_RATE_MAX_PER_HOUR: process.env.OTP_RATE_MAX_PER_HOUR || 5,
  OTP_MAX_VERIFY_ATTEMPTS: process.env.OTP_MAX_VERIFY_ATTEMPTS || 5,
  OTP_HMAC_SECRET: process.env.OTP_HMAC_SECRET || "09dc0abbb2961391d822610b31b912e3231d4d2745c76b1ef4765af4c62f6079",

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || "0f8bf908f8d38527c188c93bda49d48bd421a43fa0bdf3e77de1f0db785e6f37",
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || "826d2c0edb5ad8f8ac7668556c034ea228931a49576aefccc80d6f469cc4a34c4da82ca43a5c43de91ffdad2f4644c655e2eb3ccbb8bc2848cb64fe7ea2a1ab9",
  ACCESS_TOKEN_EXP: process.env.ACCESS_TOKEN_EXP || "15m",
  REFRESH_TOKEN_EXP: process.env.REFRESH_TOKEN_EXP || "7d",
  ACCESS_TOKEN_EXP_SEC: Number(process.env.ACCESS_TOKEN_EXP_SEC || 900),
  REFRESH_TOKEN_EXP_SEC: Number(process.env.REFRESH_TOKEN_EXP_SEC || 604800),
  REDIS_USER_TTL: Number(process.env.REDIS_USER_TTL || 86400),


  // Gmail SMTP (used directly for OTP emails — no separate notification service)
  GMAIL_USER: process.env.GMAIL_USER,
  GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
  MAIL_FROM: process.env.MAIL_FROM,

  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,

  INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY,
}


if (!config.GOOGLE_CLIENT_ID) {
  throw new Error("GOOGLE_CLIENT_ID environment variable is required");
}

if (!config.GMAIL_USER) {
  throw new Error('GMAIL_USER missing');
}

if (!config.GMAIL_APP_PASSWORD) {
  throw new Error('GMAIL_APP_PASSWORD missing');
}
module.exports = { config };