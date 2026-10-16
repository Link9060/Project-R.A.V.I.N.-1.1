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
