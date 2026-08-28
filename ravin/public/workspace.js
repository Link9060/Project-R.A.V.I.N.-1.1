/* RAVIN workspace: lightweight local-first tools around the Core. */
(()=>{
const $=id=>document.getElementById(id), $$=sel=>Array.from(document.querySelectorAll(sel));
const panel=$("workspacePanel"), openBtn=$("workspaceBtn"), closeBtn=$("workspaceClose"), tabs=$$(".workspace-tab"), panes=$$(".workspace-pane");
const store={get:(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}},set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
const renderEmpty=(el,text)=>{if(el&&!el.children.length)el.innerHTML=`<div class="workspace-empty">${text}</div>`};
function open(){panel?.classList.add("open");openBtn?.setAttribute("aria-expanded","true")}
function close(){panel?.classList.remove("open");openBtn?.setAttribute("aria-expanded","false")}
openBtn?.addEventListener("click",e=>{e.preventDefault();panel?.classList.contains("open")?close():open()});closeBtn?.addEventListener("click",close);
tabs.forEach(tab=>tab.addEventListener("click",()=>{const name=tab.dataset.tab;tabs.forEach(t=>t.classList.toggle("active",t===tab));panes.forEach(p=>p.classList.toggle("active",p.dataset.pane===name))}));

const notesKey="ravin_workspace_notes",notes=$("notesArea");if(notes){notes.value=localStorage.getItem(notesKey)||"";notes.addEventListener("input",()=>localStorage.setItem(notesKey,notes.value))}

const taskKey="ravin_workspace_tasks",taskInput=$("taskInput"),taskAdd=$("taskAdd"),taskList=$("taskList");let tasks=store.get(taskKey,[]);
function renderTasks(){if(!taskList)return;taskList.innerHTML="";tasks.forEach((t,i)=>{const row=document.createElement("label");row.className="workspace-item task-item";row.innerHTML=`<input type="checkbox" ${t.done?"checked":""}><span></span><button type="button" aria-label="Delete">×</button>`;row.querySelector("span").textContent=t.text;row.querySelector("input").addEventListener("change",e=>{tasks[i].done=e.target.checked;store.set(taskKey,tasks);renderTasks()});row.querySelector("button").addEventListener("click",()=>{tasks.splice(i,1);store.set(taskKey,tasks);renderTasks()});taskList.appendChild(row)});renderEmpty(taskList,"No tasks yet.")}
function addTask(){const text=taskInput?.value.trim();if(!text)return;tasks.push({text,done:false});store.set(taskKey,tasks);taskInput.value="";renderTasks()}taskAdd?.addEventListener("click",addTask);taskInput?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addTask()}});renderTasks();

const projectKey="ravin_workspace_projects",projectInput=$("projectInput"),projectAdd=$("projectAdd"),projectList=$("projectList");let projects=store.get(projectKey,[]);
function renderProjects(){if(!projectList)return;projectList.innerHTML="";projects.forEach((p,i)=>{const row=document.createElement("div");row.className="workspace-item project-item";const name=document.createElement("span");name.textContent=p;const del=document.createElement("button");del.type="button";del.textContent="×";del.addEventListener("click",()=>{projects.splice(i,1);store.set(projectKey,projects);renderProjects()});row.append(name,del);projectList.appendChild(row)});renderEmpty(projectList,"No projects pinned.")}
function addProject(){const text=projectInput?.value.trim();if(!text)return;projects.push(text);store.set(projectKey,projects);projectInput.value="";renderProjects()}projectAdd?.addEventListener("click",addProject);projectInput?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addProject()}});renderProjects();

const logList=$("logList"),logs=[];function log(text){logs.unshift({text,time:new Date()});logs.splice(40);if(!logList)return;logList.innerHTML="";logs.forEach(l=>{const row=document.createElement("div");row.className="log-row";row.innerHTML=`<time>${l.time.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})}</time><span></span>`;row.querySelector("span").textContent=l.text;logList.appendChild(row)})}
window.addEventListener("ravin:state",e=>log(`Core → ${e.detail?.state||"unknown"}${e.detail?.overdrive?" · OVERDRIVE":""}`));window.addEventListener("ravin-auth-changed",()=>log("Authentication state changed"));log("Workspace initialized");

const memoryHost=$("workspaceMemory");async function renderMemory(){if(!memoryHost)return;memoryHost.innerHTML="";if(!window.RavinAuth?.isSignedIn?.()){memoryHost.innerHTML='<div class="workspace-empty">Sign in to view permanent memory.</div>';return}if(!window.RavinMemory?.listPermanentMemories){memoryHost.innerHTML='<div class="workspace-empty">Memory service unavailable.</div>';return}try{const items=await window.RavinMemory.listPermanentMemories();(items||[]).forEach(m=>{const row=document.createElement("div");row.className="workspace-item";row.textContent=typeof m==="string"?m:(m?.content||"");memoryHost.appendChild(row)});renderEmpty(memoryHost,"Nothing saved yet.")}catch{memoryHost.innerHTML='<div class="workspace-empty">Could not load memory.</div>'}}
tabs.find(t=>t.dataset.tab==="memory")?.addEventListener("click",renderMemory);window.addEventListener("ravin-auth-changed",renderMemory);

document.addEventListener("keydown",e=>{if(e.key==="Escape"&&panel?.classList.contains("open"))close()});
window.RavinWorkspace={open,close,log};
})();
