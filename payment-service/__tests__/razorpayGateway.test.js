const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { verifyPaymentSignature, verifyWebhookSignature } = require('../src/services/gateways/signature');

const KEY_SECRET = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';

const sign = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest('hex');

test('verifyPaymentSignature accepts a correctly signed payload', () => {
     const orderId = 'order_123';
     const paymentId = 'pay_456';
     const signature = sign(KEY_SECRET, `${orderId}|${paymentId}`);
     assert.strictEqual(verifyPaymentSignature(KEY_SECRET, orderId, paymentId, signature), true);
});

test('verifyPaymentSignature rejects a tampered signature', () => {
     const orderId = 'order_123';
     const paymentId = 'pay_456';
     const valid = sign(KEY_SECRET, `${orderId}|${paymentId}`);
     // Flip the last hex char — keeps equal length but invalidates the signature.
     const tampered = valid.slice(0, -1) + (valid.slice(-1) === '0' ? '1' : '0');
     assert.strictEqual(verifyPaymentSignature(KEY_SECRET, orderId, paymentId, tampered), false);
});

test('verifyPaymentSignature rejects when signed with the wrong secret', () => {
     const orderId = 'order_123';
     const paymentId = 'pay_456';
     const signature = sign('attacker_secret', `${orderId}|${paymentId}`);
     assert.strictEqual(verifyPaymentSignature(KEY_SECRET, orderId, paymentId, signature), false);
});

test('verifyWebhookSignature accepts a correctly signed body', () => {
     const body = JSON.stringify({ event: 'payment.captured' });
     const signature = sign(WEBHOOK_SECRET, body);
     assert.strictEqual(verifyWebhookSignature(WEBHOOK_SECRET, body, signature), true);
});

test('verifyWebhookSignature rejects an invalid signature without throwing', () => {
     const body = JSON.stringify({ event: 'payment.captured' });
     assert.strictEqual(verifyWebhookSignature(WEBHOOK_SECRET, body, 'deadbeef'), false);
});

test('verifyWebhookSignature handles raw Buffer bodies', () => {
     const body = Buffer.from(JSON.stringify({ event: 'order.paid' }));
     const signature = sign(WEBHOOK_SECRET, body.toString('utf8'));
     assert.strictEqual(verifyWebhookSignature(WEBHOOK_SECRET, body, signature), true);
});

test('verifyWebhookSignature rejects an empty signature', () => {
     const body = JSON.stringify({ a: 1 });
     assert.strictEqual(verifyWebhookSignature(WEBHOOK_SECRET, body, ''), false);
});

test('verifyWebhookSignature rejects a tampered body (replay/altered amount)', () => {
     const original = JSON.stringify({ amount: 100 });
     const sig = sign(WEBHOOK_SECRET, original);
     const altered = JSON.stringify({ amount: 999 });
     assert.strictEqual(verifyWebhookSignature(WEBHOOK_SECRET, altered, sig), false);
});
