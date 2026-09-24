(()=>{
const $=id=>document.getElementById(id);
const chat=$("chat");
const input=$("messageInput");
const send=$("sendBtn");
const composer=$("composer");
const readReceiptsToggle=$("readReceiptsToggle");
const READ_RECEIPTS_KEY_PREFIX="ravin_read_receipts";

const boot=$("boot");
const bootLine=$("bootLine");
const app=$("app");
const settingsBtn=$("settingsBtn");
const settingsPanel=$("settingsPanel");
const themeToggle=$("themeToggle");
const soundToggle=$("soundToggle");
const clearBtn=$("clearBtn");

const finishBoot=()=>{
  if(!app||!boot)return;
  app.classList.add("app-visible");
  if(bootLine)bootLine.textContent="RAVIN READY";
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  window.setTimeout(()=>{
    boot.classList.add("boot-done");
    window.setTimeout(()=>{boot.hidden=true;},reduced?0:620);
  },reduced?0:420);
};

const syncThemeToggle=()=>{
  if(!themeToggle)return;
  const light=document.documentElement.getAttribute("data-theme")==="light";
  themeToggle.classList.toggle("on",light);
  themeToggle.setAttribute("aria-checked",String(light));
};

const applyLocalTheme=(theme)=>{
  document.documentElement.setAttribute("data-theme",theme);
  document.documentElement.classList.toggle("dark",theme==="dark");
  try{localStorage.setItem("ravin_theme",theme);}catch{}
  syncThemeToggle();
};

finishBoot();
syncThemeToggle();

settingsBtn?.addEventListener("click",event=>{
  event.stopPropagation();
  const next=!settingsPanel?.classList.contains("open");
  settingsPanel?.classList.toggle("open",next);
  settingsBtn.setAttribute("aria-expanded",String(next));
});

settingsPanel?.addEventListener("click",event=>event.stopPropagation());

document.addEventListener("pointerdown",event=>{
  if(!settingsPanel?.classList.contains("open"))return;
  if(settingsPanel.contains(event.target)||settingsBtn?.contains(event.target))return;
  settingsPanel.classList.remove("open");
  settingsBtn?.setAttribute("aria-expanded","false");
});

themeToggle?.addEventListener("click",()=>{
  const next=document.documentElement.getAttribute("data-theme")==="light"?"dark":"light";
  if(window.ArrowOS?.applyTheme){
    window.ArrowOS.applyTheme(next,true);
  }else{
    applyLocalTheme(next);
    try{localStorage.setItem("arrow_os_theme_v1",next);}catch{}
  }
});

window.addEventListener("arrow:themechange",event=>{
  applyLocalTheme(event.detail?.resolved==="light"?"light":"dark");
});

const soundEnabled=()=>localStorage.getItem("ravin_sound")!=="false";
const syncSoundToggle=()=>{
  if(!soundToggle)return;
  const enabled=soundEnabled();
  soundToggle.classList.toggle("on",enabled);
  soundToggle.setAttribute("aria-checked",String(enabled));
};
syncSoundToggle();
soundToggle?.addEventListener("click",()=>{
  localStorage.setItem("ravin_sound",String(!soundEnabled()));
  syncSoundToggle();
});

clearBtn?.addEventListener("click",()=>{
  chat?.replaceChildren();
  const intro=document.createElement("div");
  intro.className="intro";
  intro.innerHTML='<p class="intro-line">RAVIN is listening.</p><p class="intro-sub">Conversation cleared.</p>';
  chat?.appendChild(intro);
  window.RavinAPI?.clearConversation?.();
  input?.focus();
});


const readReceiptsStorageKey=()=>{
  const user=window.RavinAuth?.getUser?.()||window.RavinAuthState?.user;
  const identity=user?.id||user?.email||"guest";
  return `${READ_RECEIPTS_KEY_PREFIX}:${identity}`;
};

const readReceiptsEnabled=()=>localStorage.getItem(readReceiptsStorageKey())!=="false";

const syncReadReceiptsToggle=()=>{
  if(!readReceiptsToggle)return;
  const enabled=readReceiptsEnabled();
  readReceiptsToggle.classList.toggle("on",enabled);
  readReceiptsToggle.setAttribute("aria-checked",String(enabled));
};

const updateReadReceiptVisibility=()=>{
  chat?.querySelectorAll(".msg-receipt").forEach(receipt=>{
    receipt.hidden=!readReceiptsEnabled();
  });
};

readReceiptsToggle?.addEventListener("click",()=>{
  localStorage.setItem(readReceiptsStorageKey(),String(!readReceiptsEnabled()));
  syncReadReceiptsToggle();
  updateReadReceiptVisibility();
});

window.addEventListener("ravin-auth-changed",()=>{
  syncReadReceiptsToggle();
  updateReadReceiptVisibility();
});

syncReadReceiptsToggle();

const formatMessageTime=(value)=>{
  const date=value instanceof Date?value:new Date(value);
  return date.toLocaleTimeString([],{
    hour:"numeric",
    minute:"2-digit"
  });
};

const formatMessageDateTime=(value)=>{
  const date=value instanceof Date?value:new Date(value);
  return date.toLocaleString([],{
    month:"short",
    day:"numeric",
    year:"numeric",
    hour:"numeric",
    minute:"2-digit"
  });
};

const addMessage=(role,text,timestamp=new Date())=>{
  if(!chat)return null;

  const intro=chat.querySelector(".intro");
  if(intro)intro.remove();

  const normalizedRole=role==="assistant"?"ravin":role;
  const message=document.createElement("div");
  message.className=`msg ${normalizedRole}`;

  const header=document.createElement("div");
  header.className="msg-header";

  const label=document.createElement("span");
  label.className="msg-label";
  label.textContent=normalizedRole==="user"?"YOU":normalizedRole==="ravin"?"RAVIN":"SYSTEM";

  const time=document.createElement("time");
  time.className="msg-time";
  time.dateTime=(timestamp instanceof Date?timestamp:new Date(timestamp)).toISOString();
  time.textContent=formatMessageTime(timestamp);
  time.title=formatMessageDateTime(timestamp);
  time.setAttribute("aria-label",`Sent ${formatMessageDateTime(timestamp)}`);

  const body=document.createElement("div");
  body.className="msg-body";
  if(normalizedRole==="ravin"&&typeof window.renderMarkdown==="function"){
    body.innerHTML=window.renderMarkdown(String(text));
  }else{
    body.textContent=text;
  }

  header.append(label,time);
  message.append(header,body);

  if(normalizedRole==="user"){
    const receipt=document.createElement("span");
    receipt.className="msg-time msg-receipt";
    receipt.textContent="Sent";
    receipt.hidden=!readReceiptsEnabled();
    receipt.setAttribute("aria-live","polite");
    message.appendChild(receipt);
  }

  chat.appendChild(message);
  chat.scrollTop=chat.scrollHeight;
  return message;
};

const markMessageRead=(message,timestamp=new Date())=>{
  const receipt=message?.querySelector(".msg-receipt");
  if(!receipt)return;
  receipt.textContent="Read";
  receipt.title=`Read ${formatMessageDateTime(timestamp)}`;
  receipt.setAttribute("aria-label",`Read ${formatMessageDateTime(timestamp)}`);
};

const setComposerBusy=(busy)=>{
  if(input)input.disabled=busy;
  if(send){send.disabled=busy;send.setAttribute("aria-busy",String(busy));}
};

async function sendMessage(){
  const text=input?.value?.trim();
  if(!text)return;
  if(input)input.value="";
  const userMessage=addMessage("user",text);
  setComposerBusy(true);
  try{
    if(!window.RavinAPI?.chat)throw new Error("RAVIN API is not available.");
    const result=await window.RavinAPI.chat(text);
    const content=result?.reply??result?.content??result?.text??result?.message?.content;
    if(content){
      markMessageRead(userMessage);
      addMessage("assistant",content);
    }else addMessage("error","RAVIN returned no visible content.");
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
  if(event.key==="Escape"){
    if(settingsPanel?.classList.contains("open")){
      settingsPanel.classList.remove("open");
      settingsBtn?.setAttribute("aria-expanded","false");
      settingsBtn?.focus();
      return;
    }
    if(input)input.value="";
  }
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

renderMemoryList();
})();
