// user-service config validates these at import time — set them before requiring.
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client';
process.env.GMAIL_USER = process.env.GMAIL_USER || 'test@example.com';
process.env.GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || 'test-app-password';

const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const {
     generateAccessToken,
     generateRefreshToken,
     verifyAccessToken,
     hashToken,
} = require('../src/utils/auth');

test('generateAccessToken embeds the user id and verifies round-trip', () => {
     const token = generateAccessToken('user-1');
     const decoded = verifyAccessToken(token);
     assert.strictEqual(decoded.id, 'user-1');
});

test('generateRefreshToken includes a unique jti each time', () => {
     const t1 = generateRefreshToken('user-1');
     const t2 = generateRefreshToken('user-1');
     assert.ok(jwt.decode(t1).jti);
     assert.notStrictEqual(jwt.decode(t1).jti, jwt.decode(t2).jti);
});

test('verifyAccessToken rejects a token signed with the wrong secret', () => {
     const forged = jwt.sign({ id: 'attacker' }, 'wrong-secret');
     assert.throws(() => verifyAccessToken(forged));
});

test('hashToken is deterministic and does not leak the original token', () => {
     const raw = 'some-refresh-token';
     const h1 = hashToken(raw);
     const h2 = hashToken(raw);
     assert.strictEqual(h1, h2);
     assert.ok(!h1.includes(raw));
     assert.strictEqual(h1.length, 64); // sha256 hex digest
});
