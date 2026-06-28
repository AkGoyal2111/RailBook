const { test } = require('node:test');
const assert = require('node:assert');
const getDeviceFingerprint = require('../src/utils/deviceFingerprint');

const makeReq = (headers = {}, ip = '') => ({ headers, ip });

test('produces a stable 16-char fingerprint for the same request', () => {
     const req = makeReq({ 'user-agent': 'Chrome', accept: 'text/html' }, '1.2.3.4');
     const a = getDeviceFingerprint(req);
     const b = getDeviceFingerprint(req);
     assert.strictEqual(a, b);
     assert.strictEqual(a.length, 16);
});

test('different user agents yield different fingerprints', () => {
     const r1 = makeReq({ 'user-agent': 'Chrome' }, '1.2.3.4');
     const r2 = makeReq({ 'user-agent': 'Firefox' }, '1.2.3.4');
     assert.notStrictEqual(getDeviceFingerprint(r1), getDeviceFingerprint(r2));
});

test('different IPs yield different fingerprints', () => {
     const r1 = makeReq({ 'user-agent': 'Chrome' }, '1.2.3.4');
     const r2 = makeReq({ 'user-agent': 'Chrome' }, '5.6.7.8');
     assert.notStrictEqual(getDeviceFingerprint(r1), getDeviceFingerprint(r2));
});

test('handles missing headers and ip without throwing', () => {
     const fp = getDeviceFingerprint({ headers: {} });
     assert.strictEqual(typeof fp, 'string');
     assert.strictEqual(fp.length, 16);
});
