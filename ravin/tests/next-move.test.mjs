import {test} from 'node:test';import assert from 'node:assert/strict';
import {planningCandidates,validateNextChoice} from '../src/nextMove.js';
test('next move ignores completed tasks, past timed events and unmet dependencies',()=>{const list=planningCandidates({now:new Date('2026-10-01T14:30:00Z'),timezone:'America/Chicago',tasks:[{id:'done',title:'Done',completed:true},{id:'open',title:'Homework',completed:false,due_on:'2026-10-01'}],events:[{id:'past',title:'Past',event_date:'2026-10-01',start_time:'08:00'},{id:'soon',title:'Class',event_date:'2026-10-01',start_time:'10:00'}],plans:[{id:'blocked',status:'active',depends_on:['missing']}]});assert.equal(list[0].id,'soon');assert.deepEqual(list.map(c=>c.id),['soon','open']);});
test('model cannot invent a location, event, title or scheduled time',()=>{const candidates=[{id:'a',kind:'event',title:'Real event',date:'2026-10-01',time:'10:00'}];assert.equal(validateNextChoice(candidates,{id:'b',kind:'event'}),null);assert.equal(validateNextChoice(candidates,{id:'a',kind:'task'}),null);const result=validateNextChoice(candidates,{id:'a',kind:'event',title:'Fake',time:'18:00',reason:'Next event'});assert.equal(result.title,'Real event');assert.equal(result.time,'10:00');});

test('title and ID dependencies unlock after completion; ambiguous titles stay blocked',()=>{
 const base={now:new Date('2026-10-11T13:00:00Z'),timezone:'UTC',tasks:[{id:'prereq',title:'Research',completed:true}],plans:[{id:'plan',title:'Build',status:'active',depends_on:['Research']}]};
 assert.equal(planningCandidates(base).some(x=>x.id==='plan'),true);
 base.plans[0].depends_on=['prereq'];assert.equal(planningCandidates(base).some(x=>x.id==='plan'),true);
 base.tasks.push({id:'other',title:'Research',completed:false});base.plans[0].depends_on=['Research'];assert.equal(planningCandidates(base).some(x=>x.id==='plan'),false);
});
