/**
 * Server-side ONLY: RAVIN service -> isolated Hermes Agent API.
 *
 * No browser imports. Call from the authenticated RAVIN mission worker after
 * checking the owner, execution policy and mission limits.
 *
 * This adapter does not sandbox Hermes. Before enabling, configure the Hermes
 * gateway with NO terminal, browser, filesystem, or other effectful tools and
 * an isolated execution environment. A prompt cannot enforce tool permissions.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

export class HermesAdapterError extends Error {
  constructor(message, code = 'HERMES_ERROR') {
    super(message);
    this.name = 'HermesAdapterError';
    this.code = code;
  }
}

export function createHermesAdapter({
  baseUrl = process.env.ARRAY_HERMES_URL,
  apiKey = process.env.ARRAY_HERMES_API_KEY,
  enabled = process.env.ARRAY_HERMES_ENABLED === 'true',
  sandboxConfirmed = process.env.ARRAY_HERMES_SANDBOX_CONFIRMED === 'true',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!enabled) {
    return {
      enabled: false,
      async execute() { throw new HermesAdapterError('Hermes backend is disabled.', 'DISABLED'); },
      async health() { return { ready: false, reason: 'disabled' }; },
    };
  }
  if (!sandboxConfirmed) throw new HermesAdapterError(
    'Hermes requires an independently enforced effect-free sandbox before use.',
    'SANDBOX_REQUIRED',
  );
  if (!baseUrl || !apiKey) throw new HermesAdapterError(
    'ARRAY_HERMES_URL and ARRAY_HERMES_API_KEY are required.', 'CONFIG_REQUIRED',
  );
  let endpoint;
  try {
    const origin = new URL(baseUrl);
    const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(origin.hostname);
    if (origin.username || origin.password || origin.search || origin.hash ||
        (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && isLoopback))) {
      throw new Error('Invalid URL');
    }
    endpoint = origin.href.replace(/\/+$/, '').replace(/\/v1$/, '');
  } catch {
    throw new HermesAdapterError('Hermes endpoint must be HTTPS (or local loopback HTTP).', 'INVALID_URL');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000)
    throw new HermesAdapterError('Hermes timeout must be 1–300 seconds.', 'INVALID_TIMEOUT');
  if (typeof fetchImpl !== 'function') throw new HermesAdapterError('A fetch implementation is required.', 'CONFIG_REQUIRED');

  async function request(path, body, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetchImpl(endpoint + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      if (!response.ok) throw new HermesAdapterError(
        'Hermes API request failed (HTTP ' + response.status + ').', 'UPSTREAM_FAILED',
      );
      return await response.json();
    } catch (error) {
      if (error instanceof HermesAdapterError) throw error;
      if (controller.signal.aborted) throw new HermesAdapterError(
        signal?.aborted ? 'Hermes request canceled.' : 'Hermes request timed out.',
        signal?.aborted ? 'CANCELED' : 'TIMEOUT',
      );
      throw new HermesAdapterError('Hermes API could not be reached.', 'UNREACHABLE');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    enabled: true,
    async health() {
      try {
        const data = await request('/v1/models');
        return { ready: Array.isArray(data?.data) &&
          data.data.some(item => item.id === 'hermes-agent') };
      } catch {
        return { ready: false, reason: 'upstream_unavailable' };
      }
    },
    async execute({ objective, policy, instructions = '', signal } = {}) {
      if (!['assist', 'review'].includes(policy)) throw new HermesAdapterError(
        'This adapter only supports non-effectful assist/review missions.', 'POLICY_DENIED',
      );
      if (typeof objective !== 'string' || !objective.trim() || objective.length > 1_200)
        throw new HermesAdapterError('Objective must contain 1–1200 characters.', 'INVALID_OBJECTIVE');
      if (typeof instructions !== 'string' || instructions.length > 400)
        throw new HermesAdapterError('Instructions exceed the 400-character limit.', 'INVALID_INSTRUCTIONS');

      const policyText = policy === 'review'
        ? 'Provide a proposed solution, its assumptions, and a verification checklist.'
        : 'Provide a direct informational response.';
      const prompt = [
        'You are a software-only ARRAY assistant. Return text only.',
        'Do not operate on files, run commands, browse, publish or change external systems.',
        'Execution permissions are independently restricted by the Hermes sandbox.',
        policyText,
        instructions.trim(),
      ].filter(Boolean).join('\n');
      const result = await request('/v1/chat/completions', {
        model: 'hermes-agent',
        stream: false,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: objective.trim() },
        ],
      }, signal);
      const choice = result?.choices?.[0];
      const text = choice?.message?.content;
      if (choice?.finish_reason !== 'stop' || typeof text !== 'string' || !text.trim()) {
        throw new HermesAdapterError(
          'Hermes did not return a completed text response.', 'INCOMPLETE_RESULT',
        );
      }
      return {
        output: text,
        engine: 'hermes',
        model: 'hermes-agent',
        // No fabricated phases, timings, token costs, or execution claims.
        usage: result?.usage ?? null,
      };
    },
  };
}
