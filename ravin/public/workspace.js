/* RAVIN workspace: bottom dock + local-first tools. */
(()=>{
const $=id=>document.getElementById(id), $$=sel=>Array.from(document.querySelectorAll(sel));
const panel=$("workspacePanel"), closeBtn=$("workspaceClose"), settingsPanel=$("settingsPanel");
const panes=$$(".workspace-pane"), legacyTabs=$$(".workspace-tab");
const store={get:(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}},set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
const renderEmpty=(el,text)=>{if(el&&!el.children.length)el.innerHTML=`<div class="workspace-empty">${text}</div>`};

/* Load dock-specific layout after the base stylesheet. */
if(!document.querySelector('link[href*="dock.css"]')){const l=document.createElement("link");l.rel="stylesheet";l.href="dock.css?v=1";document.head.appendChild(l)}

/* Build the persistent dock. */
const dock=document.createElement("nav");dock.className="ravin-dock";dock.setAttribute("aria-label","RAVIN workspace dock");
const dockItems=[
  ["notes","NOTES"],["tasks","TASKS"],["memory","MEMORY"],["projects","PROJECTS"],["logs","LOGS"],["settings","SETTINGS"]
];
dockItems.forEach(([name,label])=>{const b=document.createElement("button");b.type="button";b.dataset.dock=name;b.textContent=label;dock.appendChild(b)});
document.getElementById("app")?.appendChild(dock);
const dockButtons=$$(".ravin-dock button");

function mark(name){dockButtons.forEach(b=>b.classList.toggle("active",b.dataset.dock===name))}
function closeWorkspace(){panel?.classList.remove("open");mark(null)}
function showPane(name){
  settingsPanel?.classList.remove("open");
  const already=panel?.classList.contains("open")&&dock.querySelector(`[data-dock="${name}"]`)?.classList.contains("active");
  if(already){closeWorkspace();return}
  panes.forEach(p=>p.classList.toggle("active",p.dataset.pane===name));
  legacyTabs.forEach(t=>t.classList.toggle("active",t.dataset.tab===name));
  panel?.classList.add("open");mark(name);
  if(name==="memory")renderMemory();
}
function showSettings(){
  const wasOpen=settingsPanel?.classList.contains("open");
  panel?.classList.remove("open");
  settingsPanel?.classList.toggle("open",!wasOpen);
  mark(wasOpen?null:"settings");
}
dockButtons.forEach(b=>b.addEventListener("click",()=>b.dataset.dock==="settings"?showSettings():showPane(b.dataset.dock)));
closeBtn?.addEventListener("click",closeWorkspace);
document.getElementById("settingsClose")?.addEventListener("click",()=>{settingsPanel?.classList.remove("open");mark(null)});

/* Existing top buttons still work if another layout exposes them. */
document.getElementById("workspaceBtn")?.addEventListener("click",e=>{e.preventDefault();showPane("notes")});
document.getElementById("settingsBtn")?.addEventListener("click",e=>{e.preventDefault();showSettings()});
legacyTabs.forEach(tab=>tab.addEventListener("click",()=>showPane(tab.dataset.tab)));

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
window.addEventListener("ravin-auth-changed",renderMemory);

document.addEventListener("click",e=>{if(settingsPanel?.classList.contains("open")&&!settingsPanel.contains(e.target)&&!e.target.closest?.('[data-dock="settings"]')){settingsPanel.classList.remove("open");mark(null)}});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){panel?.classList.remove("open");settingsPanel?.classList.remove("open");mark(null)}});
window.RavinWorkspace={open:()=>showPane("notes"),close:closeWorkspace,log,showPane};
})();
