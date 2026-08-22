(()=>{
const $=id=>document.getElementById(id);
const addMessage=(role,text)=>{const c=$("chat");if(!c)return;const d=document.createElement("div");d.className=`message ${role}`;d.textContent=text;c.appendChild(d);c.scrollTop=c.scrollHeight;};
const input=$("input");const send=$("send");
async function sendMessage(){const text=input?.value?.trim();if(!text)return;input.value="";addMessage("user",text);try{const r=await window.RavinAPI?.chat?.(text);if(r?.content)addMessage("assistant",r.content);else if(r?.text)addMessage("assistant",r.text);else addMessage("error","RAVIN returned no visible content.");}catch(e){addMessage("error",`RAVIN error: ${e.message}`)}}
if(send)send.addEventListener("click",sendMessage);if(input)input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage()}});
const memoryList=$("memoryList"),memoryAddInput=$("memoryAddInput"),memoryAddBtn=$("memoryAddBtn");
async function addMemory(){const content=memoryAddInput?.value?.trim();if(!content)return;if(window.RavinMemory?.addPermanentMemory){try{await window.RavinMemory.addPermanentMemory(content,"fact");memoryAddInput.value="";renderMemoryList()}catch(e){addMessage("error",`Couldn't save that memory: ${e.message}`)}}}
if(memoryAddBtn)memoryAddBtn.addEventListener("click",addMemory);if(memoryAddInput)memoryAddInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addMemory()}});
async function renderMemoryList(){if(!memoryList||!window.RavinMemory?.listPermanentMemories)return;try{const memories=await window.RavinMemory.listPermanentMemories();memoryList.innerHTML="";(memories||[]).forEach(m=>{const row=document.createElement("div");row.className="memory-row";row.textContent=typeof m==="string"?m:(m.content||"");memoryList.appendChild(row)})}catch(e){console.warn("Memory load failed:",e)}}
renderMemoryList();
})();
