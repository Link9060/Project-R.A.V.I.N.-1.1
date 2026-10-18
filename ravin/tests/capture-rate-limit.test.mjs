import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interpretWaypointDump} from '../src/waypointInterpreter.js';
const good={choices:[{message:{content:JSON.stringify({summary:'Plan',items:[],route:[{title:'Study'}],questions:[]})}}]};
async function scenario(responses,run){const before=globalThis.fetch;const priorAccount=process.env.CLOUDFLARE_ACCOUNT_ID,priorToken=process.env.CLOUDFLARE_API_TOKEN;process.env.CLOUDFLARE_ACCOUNT_ID='fixture';process.env.CLOUDFLARE_API_TOKEN='fixture';let calls=0;globalThis.fetch=async()=>{const value=responses[calls++];assert.ok(value,'no extra requests');return value;};try{await run(()=>calls);}finally{globalThis.fetch=before;if(priorAccount===undefined)delete process.env.CLOUDFLARE_ACCOUNT_ID;else process.env.CLOUDFLARE_ACCOUNT_ID=priorAccount;if(priorToken===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=priorToken;}}
const limited=(code,retry='0')=>new Response(JSON.stringify({errors:[{code,message:'AI limit'}]}),{status:429,headers:{'Retry-After':retry}});
test('short capacity limits recover with one bounded retry',async()=>scenario([limited(3040),new Response(JSON.stringify(good))],async calls=>{const result=await interpretWaypointDump('Study');assert.equal(result.summary,'Plan');assert.equal(calls(),2);}));
test('exhausted provider allowance never retries',async()=>scenario([limited(3036)],async calls=>{await assert.rejects(interpretWaypointDump('Study'),error=>error.code==='CLOUDFLARE_QUOTA_EXHAUSTED'&&error.retryable===false);assert.equal(calls(),1);}));
test('long Retry-After is preserved without an early retry',async()=>scenario([limited(3040,'120')],async calls=>{await assert.rejects(interpretWaypointDump('Study'),error=>error.retryAfterMs===120000);assert.equal(calls(),1);}));
test('repeated capacity errors stop after the second request',async()=>scenario([limited(3040),limited(3040)],async calls=>{await assert.rejects(interpretWaypointDump('Study'),error=>error.status===429);assert.equal(calls(),2);}));

test('quota errors preserve an explicit long Retry-After without retrying',async()=>scenario([limited(3036,'3600')],async calls=>{await assert.rejects(interpretWaypointDump('Study'),error=>error.retryAfterMs===3600000 && error.retryable===false);assert.equal(calls(),1);}));
