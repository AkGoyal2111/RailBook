const { test } = require('node:test');
const assert = require('node:assert');
const CircuitBreaker = require('../src/services/circuitBreaker');

test('starts CLOSED and passes through successful requests', async () => {
     const cb = new CircuitBreaker('test', 3, 1000);
     const res = await cb.execute(() => Promise.resolve('ok'));
     assert.strictEqual(res, 'ok');
     assert.strictEqual(cb.getState().state, 'CLOSED');
});

test('opens only after reaching the failure threshold', async () => {
     const cb = new CircuitBreaker('test', 2, 1000);

     await assert.rejects(cb.execute(() => Promise.reject(new Error('boom'))), /boom/);
     assert.strictEqual(cb.getState().state, 'CLOSED'); // 1 failure, under threshold

     await assert.rejects(cb.execute(() => Promise.reject(new Error('boom'))), /boom/);
     assert.strictEqual(cb.getState().state, 'OPEN'); // 2 failures -> tripped
});

test('rejects fast without invoking the request while OPEN', async () => {
     const cb = new CircuitBreaker('test', 1, 1000);
     await assert.rejects(cb.execute(() => Promise.reject(new Error('boom'))), /boom/); // opens

     let called = false;
     const spy = () => { called = true; return Promise.resolve('should-not-run'); };
     await assert.rejects(cb.execute(spy), /unavailable|OPEN/i);
     assert.strictEqual(called, false);
});

test('transitions to HALF_OPEN after the timeout and CLOSES on success', async () => {
     const cb = new CircuitBreaker('test', 1, 50);
     await assert.rejects(cb.execute(() => Promise.reject(new Error('boom'))), /boom/);
     assert.strictEqual(cb.getState().state, 'OPEN');

     await new Promise((r) => setTimeout(r, 60)); // wait past the open timeout

     const res = await cb.execute(() => Promise.resolve('recovered'));
     assert.strictEqual(res, 'recovered');
     assert.strictEqual(cb.getState().state, 'CLOSED');
});

test('a successful call resets the failure count', async () => {
     const cb = new CircuitBreaker('test', 3, 1000);
     await assert.rejects(cb.execute(() => Promise.reject(new Error('boom'))));
     await cb.execute(() => Promise.resolve('ok'));
     assert.strictEqual(cb.getState().failureCount, 0);
});

test('a failed probe in HALF_OPEN re-opens the circuit', async () => {
     const cb = new CircuitBreaker('test', 1, 50);
     await assert.rejects(cb.execute(() => Promise.reject(new Error('boom'))), /boom/); // OPEN
     await new Promise((r) => setTimeout(r, 60));
     // next call probes (HALF_OPEN); failing must trip straight back to OPEN
     await assert.rejects(cb.execute(() => Promise.reject(new Error('again'))), /again/);
     assert.strictEqual(cb.getState().state, 'OPEN');
});

test('getState reports nextAttempt only while OPEN', async () => {
     const cb = new CircuitBreaker('test', 1, 1000);
     assert.strictEqual(cb.getState().nextAttempt, null);
     await assert.rejects(cb.execute(() => Promise.reject(new Error('boom'))));
     assert.ok(cb.getState().nextAttempt); // ISO timestamp once OPEN
});
