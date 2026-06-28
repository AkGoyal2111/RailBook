const crypto = require('crypto');

// Pure HMAC signature helpers — extracted from the Razorpay gateway so the
// security-critical verification logic can be unit-tested without the SDK.

const hmacHex = (secret, body) =>
     crypto.createHmac('sha256', secret).update(body).digest('hex');

// Constant-time compare; returns false (instead of throwing) on length mismatch.
const safeEqual = (a, b) => {
     try {
          return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
     } catch {
          return false;
     }
};

// Razorpay checkout signature: HMAC(keySecret, "orderId|paymentId").
const verifyPaymentSignature = (keySecret, orderId, paymentId, signature) =>
     safeEqual(hmacHex(keySecret, `${orderId}|${paymentId}`), signature);

// Razorpay webhook signature: HMAC(webhookSecret, rawBody).
const verifyWebhookSignature = (webhookSecret, rawBody, signature) => {
     const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
     return safeEqual(hmacHex(webhookSecret, body), signature);
};

module.exports = { hmacHex, safeEqual, verifyPaymentSignature, verifyWebhookSignature };
