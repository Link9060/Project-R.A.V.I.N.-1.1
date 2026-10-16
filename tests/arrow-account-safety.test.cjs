const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const key='sb-cnorozrjugxpanpfmssa-auth-token';
function bridge(fetch,session={access_token:'access',refresh_token:'refresh',user:{id:'owner'}}) {
  const values=new Map([[key,JSON.stringify(session)],['ravin_conversation_id_work','previous-account-chat']]);
  const window={dispatchEvent(){},addEventListener(){},setInterval(){}};
  const location={hostname:'link9060.github.io',pathname:'/Resonant-Relay/arrow/ravin/',assign(){}};
  vm.runInNewContext(fs.readFileSync('ravin/public/arrow-auth-bridge.js','utf8'),{window,location,localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},fetch,AbortSignal,CustomEvent:class{}});
  return {api:window.RavinAuth,values};
}
test('RAVIN shares token refreshes and cannot restore a signed-out account',async()=>{
  let resolve;let count=0;
  const pending=new Promise(done=>{resolve=done;});
  const f=bridge(async()=>{count++;await pending;return {ok:true,json:async()=>({access_token:'fresh',refresh_token:'rotated',user:{id:'owner'}})};});
  const first=f.api.refreshSession();const second=f.api.refreshSession();f.values.delete(key);resolve();
  assert.deepEqual(await Promise.all([first,second]),[false,false]);assert.equal(count,1);assert.equal(f.values.has(key),false);
});
test('a new account does not inherit the previous conversation IDs',()=>{
  const f=bridge(()=>assert.fail('unexpected request'));assert.equal(f.values.has('ravin_conversation_id_work'),false);
});
function sse() {
  const source=fs.readFileSync('ravin/public/ravin-v02.js','utf8');
  const start=source.indexOf('  async function readSse(');const end=source.indexOf('  async function streamRequest(',start);
  const context={TextDecoder,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(source.slice(start,end),context);return context.readSse;
}
test('SSE handles events split across chunks and releases the stream reader',async()=>{
  const read=sse();const encoder=new TextEncoder();const received=[];
  const stream=new ReadableStream({start(controller){controller.enqueue(encoder.encode('event: token\ndata: {"text":"hel'));controller.enqueue(encoder.encode('lo"}\n\nevent: done\ndata: {"reply":"hello"}\n\n'));controller.close();}});
  await read(new Response(stream),{token:data=>received.push(data.text),done:data=>received.push(data.reply)});
  assert.deepEqual(received,['hello','hello']);assert.equal(stream.locked,false);
});
test('SSE cancels and unlocks the response when a backend error handler throws',async()=>{
  const read=sse();let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('event: error\ndata: {"message":"failure"}\n\n'));},cancel(){cancelled=true;}});
  await assert.rejects(read(new Response(stream),{error:()=>{throw new Error('failure');}}),/failure/);
  assert.equal(cancelled,true);assert.equal(stream.locked,false);
});
function notificationEntry(search,rows) {
 const source=fs.readFileSync('ravin/public/ravin-shell.js','utf8');const start=source.indexOf('  async function initializeSession()');const end=source.indexOf('  function init()',start);const calls=[];
 const context={URLSearchParams,location:{search},renderUser(){},syncModeUI(){},syncOnlineState(){},resizeComposer(){},currentToken:()=> 'test',currentUser:()=>({id:'owner'}),ensureToken:async()=>{},loadConversations:async()=>{},loadCurrentMode:async()=>calls.push('default'),supabase:async url=>{calls.push(url);return rows;},openConversation:async row=>calls.push(row.id),notify:text=>calls.push(text),console,renderHistory(){},emptyState(){},openAuth(){},clearSession(){}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);return {run:()=>context.initializeSession(),calls};
}
test('notification deep links look up the exact conversation with the signed-in owner filter',async()=>{
 const id='11111111-1111-4111-8111-111111111111';const f=notificationEntry('?conversation_id='+id,[{id,metadata:{mode:'work'}}]);await f.run();assert.match(f.calls[0],/id=eq\.11111111/);assert.match(f.calls[0],/user_id=eq\.owner/);assert.equal(f.calls[1],id);assert.ok(!f.calls.includes('default'));
});
test('unavailable notification conversations cannot open another account chat',async()=>{
 const f=notificationEntry('?conversation_id=11111111-1111-4111-8111-111111111111',[]);await f.run();assert.ok(f.calls.includes('This conversation is unavailable for your account.'));assert.ok(f.calls.includes('default'));
});

test('public sign-in preserves the notification conversation return URL',()=>{
 const values=new Map();let target='';const location={hostname:'enterarrow.com',pathname:'/ravin/',search:'?conversation_id=reply-id',hash:'',assign:url=>{target=url;},origin:'https://enterarrow.com'};
 const window={location,dispatchEvent(){},addEventListener(){},setInterval(){}};
 vm.runInNewContext(fs.readFileSync('ravin/public/arrow-auth-bridge.js','utf8'),{window,location,URL,localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},CustomEvent:class{}});
 window.RavinAuth.open();assert.equal(new URL(target).searchParams.get('next'),'/ravin/?conversation_id=reply-id');
});
