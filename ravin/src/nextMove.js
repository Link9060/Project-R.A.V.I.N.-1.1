import { localClock } from "./autoPlanner.js";
// Rank only stored user data. Model output can select a candidate, never invent one.
export function planningCandidates({ tasks = [], events = [], plans = [], now = new Date(), timezone = 'America/Chicago' }) {
  let parts;
  try { parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(now); }
  catch { return planningCandidates({ tasks, events, plans, now, timezone:'America/Chicago' }); }
  const p = Object.fromEntries(parts.map(p => [p.type,p.value]));
  const today = `${p.year}-${p.month}-${p.day}`; const time = `${p.hour}:${p.minute}`;
  const upcoming = events.filter(e => e.event_date >= today && (e.event_date !== today || !e.start_time || e.start_time.slice(0,5) >= time))
    .sort((a,b) => `${a.event_date} ${a.start_time || '00:00'}`.localeCompare(`${b.event_date} ${b.start_time || '00:00'}`))
    .map((e,index) => ({ id:e.id, kind:'event', title:e.title, date:e.event_date, time:e.start_time?.slice(0,5) || null, href:'/waypoint/?tab=calendar&item='+encodeURIComponent(e.id), rank:e.event_date===today&&e.start_time&&Number(e.start_time.slice(0,2))*60+Number(e.start_time.slice(3,5)) <= localClock(now,timezone).minutes+90?-100+index:50+index, reason:'Your next calendar event.' }));
  const readyTasks = tasks.filter(t => !t.completed).sort((a,b) => (a.due_on || '9999').localeCompare(b.due_on || '9999') || (a.position || 0)-(b.position || 0))
    .map((t,index) => ({ id:t.id,kind:'task',title:t.title,date:t.scheduled_on||t.due_on,time:t.scheduled_start?.slice(0,5)||null,href:'/waypoint/?tab=today&item='+encodeURIComponent(t.id),rank:(t.scheduled_on===today&&t.scheduled_start&&t.scheduled_start.slice(0,5)<=time?-50:t.due_on&&t.due_on<=today?-20:20)+index,reason:t.due_on && t.due_on < today ? 'This task is overdue.' : 'Your next open task.' }));
  const readyPlans = plans.filter(p => p.status === 'active' && (!p.depends_on?.length || p.depends_on.every(id => tasks.some(t => t.id === id && t.completed))))
    .map((p,index) => ({id:p.id,kind:'plan',title:p.title,date:p.due_date,time:p.due_time,href:'/waypoint/?tab=plans&item='+encodeURIComponent(p.source_key || p.id),rank:40+index,reason:p.why || 'An active item in your plan.'}));
  return [...upcoming.slice(0,8),...readyTasks.slice(0,16),...readyPlans.slice(0,8)].sort((a,b)=>a.rank-b.rank);
}

export function validateNextChoice(candidates, value) {
  const chosen = candidates.find(c => c.id === value?.id && c.kind === value?.kind);
  if (!chosen) return null;
  return { ...chosen, reason: typeof value.reason === 'string' ? value.reason.slice(0,300) : chosen.reason };
}
