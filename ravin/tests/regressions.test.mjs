import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function extract(file, name) {
  const source = readFileSync(file, 'utf8');
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0);
  const end = source.indexOf('\n}', start) + 2;
  return source.slice(start, end);
}

for (const [file, name, limit] of [['server.js', 'loadConversationContext', 50], ['src/v02Routes.js', 'loadRecentMessages', 40]]) {
  test(`${name} uses latest messages, returned oldest-to-newest`, async () => {
    let query;
    const rows = Array.from({length: 75}, (_, i) => ({ role: 'user', content: String(i), created_at: i }));
    const scope = {
      RAVIN_SYSTEM_PROMPT: 'System',
      supabaseRequest: async path => {
        query = path;
        const params = new URL('https://test.invalid' + path).searchParams;
        assert.ok(params.get('user_id').startsWith('eq.'), 'owner filter required');
        const ordered = params.get('order') === 'created_at.desc' ? [...rows].reverse() : rows;
        return ordered.slice(0, Number(params.get('limit')));
      },
    };
    vm.createContext(scope);
    vm.runInContext(extract(file, name) + `\nthis.run = ${name};`, scope);
    const result = await scope.run('conversation', 'owner', 'test-token');
    const messages = result.filter(row => row.role === 'user');
    assert.equal(messages.length, limit);
    assert.equal(messages[0].content, String(75 - limit));
    assert.equal(messages.at(-1).content, '74');
    assert.ok(query.includes('conversation_id=eq.conversation'));
  });
}

test('concurrent token refreshes share one request and release the lock after failure', async () => {
  const source = readFileSync('public/ravin-shell.js', 'utf8');
  const start = source.indexOf('  let refreshPromise = null;');
  const end = source.indexOf('  async function ensureToken', start);
  let calls = 0;
  let fail = false;
  const scope = {
    AUTH_KEYS: { refresh: 'refresh' },
    localStorage: { getItem: () => 'test-refresh' },
    authRequest: async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 5));
      if (fail) throw new Error('offline');
      return { session: { access_token: 'test-access' } };
    },
    persistSession() {},
  };
  vm.createContext(scope);
  vm.runInContext(source.slice(start, end) + '\nthis.refresh = refreshAccessToken;', scope);
  const tokens = await Promise.all([scope.refresh(), scope.refresh(), scope.refresh()]);
  assert.equal(calls, 1);
  assert.deepEqual(tokens, ['test-access', 'test-access', 'test-access']);
  fail = true;
  await assert.rejects(scope.refresh(), /offline/);
  fail = false;
  assert.equal(await scope.refresh(), 'test-access');
  assert.equal(calls, 3);
});
