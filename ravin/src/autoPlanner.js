// Calendar placement is deterministic; RAVIN can prioritize only existing task IDs.
export function localClock(now = new Date(), timezone = 'America/Chicago') {
  let p;
  try { p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value])); }
  catch { return localClock(now,'America/Chicago'); }
  return {date:`${p.year}-${p.month}-${p.day}`,minutes:Number(p.hour)*60+Number(p.minute)};
}
const minute = time => { const [h,m]=String(time).split(':').map(Number); return h*60+m; };
const clock = value => `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
function dayAfter(date, offset) { const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10); }
export function buildSchedule({tasks=[],events=[],order=[],now=new Date(),timezone='America/Chicago',start='08:00',end='20:00',days=7}) {
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||minute(end)<=minute(start))throw new Error('Choose a valid planning window with an end after its start.');
  const local=localClock(now,timezone); const open=tasks.filter(t=>!t.completed);
  const priority=new Map(order.filter(id=>open.some(t=>t.id===id)).map((id,index)=>[id,index]));
  const sorted=[...open].sort((a,b)=>(a.due_on||'9999').localeCompare(b.due_on||'9999')||(priority.get(a.id)??999)-(priority.get(b.id)??999)||(a.position||0)-(b.position||0));
  const blocks=[];const unscheduled=[];const occupied=new Map();const conflicts=[];
  for(let offset=0;offset<Math.max(1,Math.min(14,days));offset++) {
    const date=dayAfter(local.date,offset);const onDay=events.filter(e=>e.event_date===date);
    for(const task of open.filter(t=>t.scheduled_on===date&&t.scheduled_start)){if(onDay.some(e=>e.source_key==='schedule:'+task.id))continue;const startAt=minute(task.scheduled_start);onDay.push({event_date:date,title:task.title,start_time:clock(startAt),end_time:clock(Math.min(1440,startAt+(Number(task.estimated_minutes)||30)))});}
    const slots=onDay.map(e=>({start:e.is_all_day||!e.start_time?0:minute(e.start_time),end:e.is_all_day||!e.start_time?1440:e.end_time?minute(e.end_time):Math.min(1440,minute(e.start_time)+60),title:e.title})).sort((a,b)=>a.start-b.start);
    for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length&&slots[j].start<slots[i].end;j++)conflicts.push(`${date}: ${slots[i].title} overlaps ${slots[j].title}.`);
    occupied.set(date,slots);
  }
  for(const task of sorted) {
    // Keep existing scheduled work; rescheduling is a separate explicit edit.
    if(task.scheduled_on&&task.scheduled_start&&task.scheduled_on>=local.date)continue;
    const duration=Math.max(5,Math.min(240,Number(task.estimated_minutes)||30));let placed=false;
    for(const [date,slots] of occupied) {
      let at=minute(start);if(date===local.date)at=Math.max(at,Math.ceil((local.minutes+5)/5)*5);
      for(const slot of [...slots].sort((a,b)=>a.start-b.start)) {if(at+duration<=slot.start)break;if(at<slot.end&&at+duration>slot.start)at=slot.end+5;}
      if(at+duration>minute(end))continue;
      const block={task_id:task.id,title:task.title,date,start:clock(at),end:clock(at+duration),minutes:duration,late:!!task.due_on&&date>task.due_on};
      blocks.push(block);slots.push({start:at,end:at+duration+5,title:task.title});placed=true;break;
    }
    if(!placed)unscheduled.push({task_id:task.id,title:task.title,reason:'No free block fits in this planning window.'});
  }
  return {blocks,unscheduled,conflicts,generated_at:now.toISOString()};
}
