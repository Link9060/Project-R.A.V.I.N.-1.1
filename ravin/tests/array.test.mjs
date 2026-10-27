import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRAY_AGENT_IDS, ARRAY_CODING_MODEL, modelForArrayMission, listArrayAgents, listArrayMissions, getArrayMission,
  createArrayMission, cancelQueuedArrayMission,
} from '../src/array/missionService.js';

test('ARRAY exposes two classes of six text-only workers', () => {
  assert.equal(ARRAY_AGENT_IDS.length, 12);
  assert.equal(listArrayAgents().length, 12);
  assert.equal(listArrayAgents().filter(agent => agent.category === 'operations').length, 6);
  assert.equal(listArrayAgents().filter(agent => agent.category === 'intelligence').length, 6);
  assert.ok(listArrayAgents().every(agent => agent.execution === 'text-only'));
});
test('rejects invalid agents, empty objectives and unauthorized tool policy', () => {
  assert.throws(() => createArrayMission('user1', {agentId:'other',objective:'test',policy:'assist'}), /Unknown/);
  assert.throws(() => createArrayMission('user1', {agentId:'intelligence-01',objective:' ',policy:'assist'}), /Objective/);
  assert.throws(() => createArrayMission('user1', {agentId:'intelligence-01',objective:'a'.repeat(4001),policy:'assist'}), /Objective/);
  assert.throws(() => createArrayMission('user1', {agentId:'intelligence-01',objective:'test',policy:'authorized'}), /not supported/);
});
test('does not disclose missions for unknown user or IDs', () => {
  assert.deepEqual(listArrayMissions('someone-without-jobs'), []);
  assert.equal(getArrayMission('someone-without-jobs','missing'), null);
  assert.deepEqual(cancelQueuedArrayMission('someone-without-jobs','missing'), {type:'not_found'});
});

test('Coding mode is explicitly routed to Qwen only for operations', () => {
  assert.equal(modelForArrayMission('operations-01', 'coding'), ARRAY_CODING_MODEL);
  assert.match(modelForArrayMission('operations-03', 'general'), /gemma/i);
  assert.match(modelForArrayMission('intelligence-06'), /granite/i);
  assert.throws(() => createArrayMission('u', {agentId: 'intelligence-01', objective: 'task', operationsMode: 'coding'}), /only to Operations/);
  assert.throws(() => createArrayMission('u', {agentId: 'operations-01', objective: 'task', operationsMode: 'other'}), /only to Operations/);
});
