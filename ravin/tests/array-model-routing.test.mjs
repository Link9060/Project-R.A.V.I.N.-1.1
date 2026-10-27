import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../src/agent/agent.js';
import { ARRAY_CODING_MODEL } from '../src/array/missionService.js';

test('Coding route makes a tool-free Cloudflare call with the exact Qwen model', async () => {
  const beforeFetch = globalThis.fetch;
  const beforeAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const beforeToken = process.env.CLOUDFLARE_API_TOKEN;
  let body;
  let endpoint = '';
  try {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
    process.env.CLOUDFLARE_API_TOKEN = 'test-token-for-mock-only';
    globalThis.fetch = async (url, options) => {
      endpoint = String(url);
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'const answer = 42;' } }],
        model: ARRAY_CODING_MODEL
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const result = await runAgent('Write a trivial constant', {
      mode: 'conversation',
      model: ARRAY_CODING_MODEL,
      responseMaxTokens: 2400,
      initialMessages: [{ role: 'system', content: 'ARRAY coding / no external tools' }]
    });
    assert.equal(result.reply, 'const answer = 42;');
    assert.ok(endpoint.endsWith('/ai/v1/chat/completions'));
    assert.equal(body.model, ARRAY_CODING_MODEL);
    assert.equal(body.max_tokens, 2400);
    assert.equal(body.messages.at(-1).role, 'user');
    assert.equal(body.tools, undefined, 'No privileged tools are sent to the model');
    assert.equal(result.performance.aiCalls[0].cloudflare.routedModel, ARRAY_CODING_MODEL);
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforeAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = beforeAccount;
    if (beforeToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = beforeToken;
  }
});
