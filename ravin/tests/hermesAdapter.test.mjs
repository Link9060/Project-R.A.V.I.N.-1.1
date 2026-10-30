import test from 'node:test';
import assert from 'node:assert/strict';
import { createHermesAdapter, HermesAdapterError } from '../src/array/hermesAdapter.mjs';

function adapter(overrides = {}) {
  return createHermesAdapter({
    enabled: true,
    sandboxConfirmed: true,
    baseUrl: 'http://127.0.0.1:8642',
    apiKey: 'fake-test-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: 'Review ready.' } }],
      }),
    }),
    ...overrides,
  });
}

test('Hermes stays off when disabled, without contacting the gateway', async () => {
  const agent = adapter({ enabled: false });
  assert.deepEqual(await agent.health(), { ready: false, reason: 'disabled' });
  await assert.rejects(agent.execute({ objective: 'Check', policy: 'assist' }),
    error => error instanceof HermesAdapterError && error.code === 'DISABLED');
});
test('requires independently enforced sandbox and server-only credentials', () => {
  assert.throws(() => adapter({ sandboxConfirmed: false }), /effect-free sandbox/);
  assert.throws(() => adapter({ apiKey: '' }), /required/);
  assert.throws(() => adapter({ baseUrl: 'http://example.com' }), /HTTPS/);
  assert.throws(() => adapter({ baseUrl: 'https://key@example.org' }), /HTTPS/);
});
test('Hermes only accepts assist or review tasks', async () => {
  await assert.rejects(adapter().execute({ objective: 'Publish it', policy: 'authorized' }),
    error => error.code === 'POLICY_DENIED');
  await assert.rejects(adapter().execute({ objective: 'a'.repeat(1201), policy: 'assist' }),
    error => error.code === 'INVALID_OBJECTIVE');
});
test('uses authenticated text-only API and records actual model provenance', async () => {
  let capture;
  const agent = adapter({ fetchImpl: async (url, options) => {
    capture = { url, options };
    return { ok: true, json: async () => ({
      choices: [{ finish_reason: 'stop', message: { content: 'Review ready.' } }],
      usage: { total_tokens: 12 },
    }) };
  } });
  const output = await agent.execute({ objective: ' Review this ', policy: 'review' });
  assert.equal(output.engine, 'hermes');
  assert.equal(output.model, 'hermes-agent');
  assert.equal(output.output, 'Review ready.');
  assert.equal(capture.url, 'http://127.0.0.1:8642/v1/chat/completions');
  assert.equal(capture.options.headers.Authorization, 'Bearer fake-test-key');
  const request = JSON.parse(capture.options.body);
  assert.equal(request.messages[1].content, 'Review this');
  assert.equal(request.stream, false);
  assert.equal(request.model, 'hermes-agent');
  assert.equal(request.tools, undefined);
});
test('treats incomplete model replies as failures', async () => {
  const agent = adapter({ fetchImpl: async () => ({
    ok: true, json: async () => ({
      choices: [{ finish_reason: 'length', message: { content: 'Partial' } }],
    }),
  }) });
  await assert.rejects(agent.execute({ objective: 'Review', policy: 'assist' }),
    error => error.code === 'INCOMPLETE_RESULT');
});
test('checks gateway health without inference', async () => {
  const agent = adapter({ fetchImpl: async (url) => {
    assert.equal(url, 'http://127.0.0.1:8642/v1/models');
    return { ok: true, json: async () => ({ data: [{ id: 'hermes-agent' }] }) };
  } });
  assert.deepEqual(await agent.health(), { ready: true });
});
