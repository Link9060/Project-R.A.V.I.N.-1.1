import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractJson,validDate,normalizeItem,interpretWaypointDump,calendarConflicts} from '../src/waypointInterpreter.js';
test('dates reject impossible days and accept leap days',()=>{assert.equal(validDate('2026-02-31'),false);assert.equal(validDate('2024-02-29'),true);assert.equal(validDate('2026-02-29'),false);assert.equal(normalizeItem({title:'Task',date:'2026-02-31'},0).date,null);});
test('structured extraction respects quoted braces and reasoning wrappers',()=>{assert.deepEqual(extractJson('<think>{not output}</think>```json\n{"summary":"brace } and \\"quote\\"", "items":[]}\n```'),{summary:'brace } and "quote"',items:[]});assert.throws(()=>extractJson('{"items":['),/complete planning/);});
test('Capture retries incomplete output, sends JSON mode, and removes existing completed duplicates',async()=>{
 const previous=globalThis.fetch;process.env.CLOUDFLARE_ACCOUNT_ID='fixture';process.env.CLOUDFLARE_API_TOKEN='fixture';let calls=0;
 globalThis.fetch=async (_url,options)=>{calls++;const body=JSON.parse(options.body);assert.deepEqual(body.response_format,{type:'json_object'});assert.equal(body.max_tokens,4096);assert.equal(body.chat_template_kwargs.enable_thinking,false);const context=JSON.parse(body.messages[1].content).waypoint_context;assert.equal(context.tasks[0].id,'done-id');assert.equal(context.events[0].end_time,'18:00');return new Response(JSON.stringify({choices:[{message:{content:calls===1?'':JSON.stringify({summary:'Plan',items:[{title:'Already done',type:'task'},{title:'Bike project',type:'project',placement:'plans',date:null}],route:[{title:'Review bike idea'}],questions:[]})}}]}),{headers:{'Content-Type':'application/json'}});};
 try {const result=await interpretWaypointDump('Already done is complete. Someday build a bike.',{waypointContext:{tasks:[{id:'done-id',title:'Already done',completed:true}],events:[{title:'Work',end_time:'18:00'}]}});assert.equal(calls,2);assert.equal(result.items.length,1);assert.equal(result.items[0].date,null);}finally{globalThis.fetch=previous;delete process.env.CLOUDFLARE_ACCOUNT_ID;delete process.env.CLOUDFLARE_API_TOKEN;}
});

test('calendar conflicts are checked independently of model reasoning',()=>{
 const items=[{type:'event',title:'Study',date:'2026-10-12',time:'17:30',duration_minutes:60},{type:'event',title:'Lesson',date:'2026-10-12',time:'18:15',duration_minutes:30}];
 const result=calendarConflicts(items,[{title:'Work',date:'2026-10-12',time:'16:00',end_time:'18:00'}]);
 assert.equal(result.length,2);assert.match(result[0].detail,/Study overlaps Work/);assert.match(result[1].detail,/Study overlaps Lesson/);
 assert.equal(calendarConflicts([{...items[0],time:'18:00',duration_minutes:15}],[{title:'Work',date:'2026-10-12',time:'16:00',end_time:'18:00'}]).length,0);
 assert.equal(normalizeItem({title:'Undated event',type:'event'},0).accepted,false);
});
