import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRAY_AGENT_IDS, listArrayAgents, listArrayMissions, getArrayMission,
  createArrayMission, cancelQueuedArrayMission,
} from '../src/array/missionService.js';

test('ARRAY exposes a fixed allowlist of 24 text-only agents', () => {
  assert.equal(ARRAY_AGENT_IDS.length, 24);
  assert.equal(listArrayAgents().length, 24);
  assert.ok(listArrayAgents().every(agent => agent.execution === 'text-only'));
});
test('rejects invalid agents, empty objectives and unauthorized tool policy', () => {
  assert.throws(() => createArrayMission('user1', {agentId:'other',objective:'test',policy:'assist'}), /Unknown/);
  assert.throws(() => createArrayMission('user1', {agentId:'scout',objective:' ',policy:'assist'}), /Objective/);
  assert.throws(() => createArrayMission('user1', {agentId:'scout',objective:'a'.repeat(4001),policy:'assist'}), /Objective/);
  assert.throws(() => createArrayMission('user1', {agentId:'scout',objective:'test',policy:'authorized'}), /not supported/);
});
test('does not disclose missions for unknown user or IDs', () => {
  assert.deepEqual(listArrayMissions('someone-without-jobs'), []);
  assert.equal(getArrayMission('someone-without-jobs','missing'), null);
  assert.deepEqual(cancelQueuedArrayMission('someone-without-jobs','missing'), {type:'not_found'});
});

test('fails closed for unknown engines and invalid Hermes payloads', () => {
  const valid = { agentId: 'scout', objective: 'Review draft', policy: 'review' };
  assert.throws(() => createArrayMission('user1', { ...valid, engine: 'not-real' }), /engine/);
  assert.throws(() => createArrayMission('user1', { ...valid, engine: 'hermes', objective: 'x'.repeat(1201) }), /length/);
  assert.throws(() => createArrayMission('user1', { ...valid, engine: 'hermes', instructions: 'x'.repeat(401) }), /Instructions/);
});
test('only advertises RAVIN until a confirmed, healthy Hermes gateway exists', async () => {
  const { listArrayCapabilities } = await import('../src/array/missionService.js');
  const previous = process.env.ARRAY_HERMES_ENABLED;
  process.env.ARRAY_HERMES_ENABLED = 'false';
  try {
    const capabilities = await listArrayCapabilities();
    assert.deepEqual(capabilities.engines, ['ravin']);
    assert.equal(capabilities.execution, 'text-only');
    assert.equal(capabilities.persistence, 'process-memory');
  } finally {
    if (previous === undefined) delete process.env.ARRAY_HERMES_ENABLED;
    else process.env.ARRAY_HERMES_ENABLED = previous;
  }
});
