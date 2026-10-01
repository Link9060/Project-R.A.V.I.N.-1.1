import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSchedule} from '../src/autoPlanner.js';
const now=new Date('2026-10-01T13:00:00Z');
test('schedule avoids calendar events and existing scheduled tasks',()=>{
 const r=buildSchedule({now,tasks:[{id:'a',title:'A',estimated_minutes:30,due_on:'2026-10-01'},{id:'b',title:'B',scheduled_on:'2026-10-01',scheduled_start:'08:30',estimated_minutes:30}],events:[{title:'Class',event_date:'2026-10-01',start_time:'09:00',end_time:'10:00'}]});
 assert.equal(r.blocks.length,1);assert.equal(r.blocks[0].start,'10:05');assert.equal(r.blocks[0].task_id,'a');
});
test('all-day events, late deadlines and insufficient capacity are explicit',()=>{
 const r=buildSchedule({now,start:'08:00',end:'09:00',days:2,tasks:[{id:'a',title:'A',due_on:'2026-10-01',estimated_minutes:60},{id:'b',title:'B',estimated_minutes:90}],events:[{event_date:'2026-10-01',title:'Away',is_all_day:true}]});
 assert.equal(r.blocks[0].date,'2026-10-02');assert.equal(r.blocks[0].late,true);assert.equal(r.unscheduled[0].task_id,'b');
});
test('untrusted prioritization cannot create tasks or override deadlines',()=>{
 const r=buildSchedule({now,tasks:[{id:'a',title:'Due',due_on:'2026-10-01'},{id:'b',title:'Later',due_on:'2026-10-05'}],order:['invented','b','a']});
 assert.deepEqual(r.blocks.map(b=>b.task_id),['a','b']);
});
test('invalid planning windows reject',()=>{assert.throws(()=>buildSchedule({start:'22:00',end:'08:00'}));});
