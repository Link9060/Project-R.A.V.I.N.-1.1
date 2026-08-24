(()=>{
const $=id=>document.getElementById(id);
const chat=$("chat");
const input=$("messageInput");
const send=$("sendBtn");
const composer=$("composer");
const boot=$("boot");
const app=$("app");
const settingsBtn=$("settingsBtn");
const settingsPanel=$("settingsPanel");

function finishBoot(){
  if(app) app.classList.add("app-visible");
  if(!boot)return;
  boot.classList.add("boot-done");
  boot.setAttribute("aria-hidden","true");
  setTimeout(()=>{boot.style.display="none";},600);
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",finishBoot,{once:true});
else finishBoot();

settingsBtn?.addEventListener("click",()=>{
  if(settingsPanel) settingsPanel.classList.toggle("open");
});

document.addEventListener("click",event=>{
  if(!settingsPanel||!settingsBtn)return;
  if(!settingsPanel.contains(event.target)&&!settingsBtn.contains(event.target)) settingsPanel.classList.remove("open");
});

const addMessage=(role,text)=>{
  if(!chat)return;
  const d=document.createElement("div");
  d.className=`message ${role}`;
  d.textContent=text;
  chat.appendChild(d);
  chat.scrollTop=chat.scrollHeight;
};

const setComposerBusy=(busy)=>{
  if(input)input.disabled=busy;
  if(send){send.disabled=busy;send.setAttribute("aria-busy",String(busy));}
};

async function sendMessage(){
  const text=input?.value?.trim();
  if(!text)return;
  if(!window.RavinAuth?.isSignedIn?.()){
    window.RavinAuth?.open?.();
    return;
  }
  if(input)input.value="";
  addMessage("user",text);
  setComposerBusy(true);
  try{
    if(!window.RavinAPI?.chat)throw new Error("RAVIN API is not available.");
    const result=await window.RavinAPI.chat(text);
    const content=result?.content??result?.text??result?.message?.content;
    if(content)addMessage("assistant",content);
    else addMessage("error","RAVIN returned no visible content.");
  }catch(error){
    console.error("[RAVIN chat]",error);
    addMessage("error",`RAVIN error: ${error?.message||error}`);
  }finally{
    setComposerBusy(false);
    input?.focus();
  }
}

composer?.addEventListener("submit",event=>{event.preventDefault();sendMessage();});
send?.addEventListener("click",event=>{if(composer)event.preventDefault();sendMessage();});
input?.addEventListener("keydown",event=>{
  if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();sendMessage();}
});

document.addEventListener("keydown",event=>{
  if(event.key==="/"&&document.activeElement!==input&&!event.ctrlKey&&!event.metaKey){event.preventDefault();input?.focus();}
  if(event.key==="Escape"&&input)input.value="";
});

const memoryList=$("memoryList");
const memoryAddInput=$("memoryAddInput");
const memoryAddBtn=$("memoryAddBtn");
const memorySection=$("memorySection");
const memoryCount=$("memoryCount");

async function renderMemoryList(){
  if(!memoryList||!window.RavinMemory?.listPermanentMemories)return;
  try{
    const memories=await window.RavinMemory.listPermanentMemories();
    memoryList.innerHTML="";
    (memories||[]).forEach(memory=>{
      const row=document.createElement("div");
      row.className="memory-row";
      row.textContent=typeof memory==="string"?memory:(memory?.content||"");
      memoryList.appendChild(row);
    });
    if(memoryCount)memoryCount.textContent=String((memories||[]).length);
  }catch(error){console.warn("[RAVIN memory] load failed:",error);}
}

async function addMemory(){
  const content=memoryAddInput?.value?.trim();
  if(!content||!window.RavinMemory?.addPermanentMemory)return;
  try{
    await window.RavinMemory.addPermanentMemory(content,"fact");
    memoryAddInput.value="";
    await renderMemoryList();
  }catch(error){
    console.error("[RAVIN memory]",error);
    addMessage("error",`Couldn't save that memory: ${error?.message||error}`);
  }
}

memoryAddBtn?.addEventListener("click",addMemory);
memoryAddInput?.addEventListener("keydown",event=>{
  if(event.key==="Enter"){event.preventDefault();addMemory();}
});

if(memorySection&&window.RavinAuth){
  const updateMemoryVisibility=()=>{memorySection.hidden=!window.RavinAuth.getUser?.();};
  updateMemoryVisibility();
  window.addEventListener("ravin-auth-changed",()=>{updateMemoryVisibility();renderMemoryList();});
}

window.addEventListener("ravin-auth-changed",()=>{
  if(window.RavinAuth?.isSignedIn?.()) settingsPanel?.classList.remove("open");
});

renderMemoryList();
})();
