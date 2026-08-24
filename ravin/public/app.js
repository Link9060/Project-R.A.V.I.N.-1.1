(()=>{
const $=id=>document.getElementById(id);
const chat=$("chat"),input=$("messageInput"),send=$("sendBtn"),composer=$("composer"),boot=$("boot"),app=$("app"),settingsBtn=$("settingsBtn"),settingsPanel=$("settingsPanel");
function finishBoot(){if(app)app.classList.add("app-visible");if(!boot)return;boot.classList.add("boot-done");boot.setAttribute("aria-hidden","true");setTimeout(()=>boot.style.display="none",600)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",finishBoot,{once:true});else finishBoot();
settingsBtn?.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();settingsPanel?.classList.toggle("open")});
document.addEventListener("click",e=>{if(settingsPanel&&!settingsPanel.contains(e.target)&&!settingsBtn?.contains(e.target))settingsPanel.classList.remove("open")});
const themeToggle=$("themeToggle"),soundToggle=$("soundToggle"),clearBtn=$("clearBtn");
function setToggle(el,on){el?.setAttribute("aria-checked",String(on));el?.classList.toggle("active",on)}
let light=document.documentElement.getAttribute("data-theme")==="light",sound=localStorage.getItem("ravin_sound")==="on";setToggle(themeToggle,light);setToggle(soundToggle,sound);
themeToggle?.addEventListener("click",e=>{e.preventDefault();light=!light;document.documentElement.setAttribute("data-theme",light?"light":"dark");localStorage.setItem("ravin_theme",light?"light":"dark");setToggle(themeToggle,light)});
soundToggle?.addEventListener("click",e=>{e.preventDefault();sound=!sound;localStorage.setItem("ravin_sound",sound?"on":"off");setToggle(soundToggle,sound)});
clearBtn?.addEventListener("click",e=>{e.preventDefault();if(chat){chat.innerHTML='<div class="intro"><p class="intro-line">RAVIN is listening.</p><p class="intro-sub">Signed in and ready.</p></div>'}});
const addMessage=(role,text)=>{if(!chat)return;const d=document.createElement("div");d.className=`message ${role}`;d.textContent=text;chat.appendChild(d);chat.scrollTop=chat.scrollHeight};
const setBusy=b=>{if(input)input.disabled=b;if(send){send.disabled=b;send.setAttribute("aria-busy",String(b))}};
async function sendMessage(){const text=input?.value?.trim();if(!text)return;if(!window.RavinAuth?.isSignedIn?.()){window.RavinAuth?.open?.();return}if(input)input.value="";addMessage("user",text);setBusy(true);try{if(!window.RavinAPI?.chat)throw new Error("RAVIN API is not available.");const result=await window.RavinAPI.chat(text);const content=result?.content??result?.text??result?.message?.content;if(content)addMessage("assistant",content);else addMessage("error","RAVIN returned no visible content.")}catch(error){console.error("[RAVIN chat]",error);addMessage("error",`RAVIN error: ${error?.message||error}`)}finally{setBusy(false);input?.focus()}}
composer?.addEventListener("submit",e=>{e.preventDefault();sendMessage()});send?.addEventListener("click",e=>{e.preventDefault();sendMessage()});input?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage()}});
document.addEventListener("keydown",e=>{if(e.key==="/"&&document.activeElement!==input&&!e.ctrlKey&&!e.metaKey){e.preventDefault();input?.focus()}if(e.key==="Escape"&&input)input.value=""});
const memoryList=$("memoryList"),memoryAddInput=$("memoryAddInput"),memoryAddBtn=$("memoryAddBtn"),memorySection=$("memorySection"),memoryCount=$("memoryCount");
async function renderMemoryList(){if(!memoryList||!window.RavinMemory?.listPermanentMemories)return;try{const memories=await window.RavinMemory.listPermanentMemories();memoryList.innerHTML="";(memories||[]).forEach(m=>{const row=document.createElement("div");row.className="memory-row";row.textContent=typeof m==="string"?m:(m?.content||"");memoryList.appendChild(row)});if(memoryCount)memoryCount.textContent=String((memories||[]).length)}catch(e){console.warn("[RAVIN memory]",e)}}
async function addMemory(){const content=memoryAddInput?.value?.trim();if(!content||!window.RavinMemory?.addPermanentMemory)return;try{await window.RavinMemory.addPermanentMemory(content,"fact");memoryAddInput.value="";await renderMemoryList()}catch(e){console.error("[RAVIN memory]",e);addMessage("error",`Couldn't save that memory: ${e?.message||e}`)}}
memoryAddBtn?.addEventListener("click",e=>{e.preventDefault();addMemory()});memoryAddInput?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addMemory()}});
if(memorySection&&window.RavinAuth){const update=()=>{memorySection.hidden=!window.RavinAuth.getUser?.()};update();window.addEventListener("ravin-auth-changed",()=>{update();renderMemoryList()})}renderMemoryList();
})();
