(function () {
  const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
  const GROQ_MODEL = "llama-3.3-70b-versatile";
  const KEY_STORAGE = "ravin_groq_key";

  const chat = document.getElementById("chat");
  const form = document.getElementById("composer");
  const input = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsPanel = document.getElementById("settingsPanel");
  const soundToggle = document.getElementById("soundToggle");
  const themeToggle = document.getElementById("themeToggle");
  const clearBtn = document.getElementById("clearBtn");
  const bootEl = document.getElementById("boot");
  const bootLine = document.getElementById("bootLine");
  const appEl = document.getElementById("app");
  const apiKeyInput = document.getElementById("apiKeyInput");
  const saveKeyBtn = document.getElementById("saveKeyBtn");
  const keyStatus = document.getElementById("keyStatus");

  let introEl = document.querySelector(".intro");
  let soundOn = localStorage.getItem("ravin_sound") === "on";
  updateSoundToggleUI();

  // ---------- API key ----------
  function getStoredKey() {
    return (localStorage.getItem(KEY_STORAGE) || "").trim();
  }

  function updateKeyStatusUI() {
    const key = getStoredKey();
    if (key) {
      keyStatus.textContent = "Saved";
      keyStatus.classList.add("key-status-ok");
      apiKeyInput.value = key;
    } else {
      keyStatus.textContent = "Not set";
      keyStatus.classList.remove("key-status-ok");
    }
  }
  updateKeyStatusUI();

  function saveKey() {
    const val = apiKeyInput.value.trim();
    if (val) {
      localStorage.setItem(KEY_STORAGE, val);
    } else {
      localStorage.removeItem(KEY_STORAGE);
    }
    updateKeyStatusUI();
    const original = saveKeyBtn.textContent;
    saveKeyBtn.textContent = "Saved";
    setTimeout(() => (saveKeyBtn.textContent = original), 1000);
  }

  saveKeyBtn.addEventListener("click", saveKey);
  apiKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveKey();
    }
  });

  function openSettingsForKey() {
    settingsPanel.classList.add("open");
    apiKeyInput.focus();
  }

  // ---------- Theme (light / dark) ----------
  let theme = document.documentElement.getAttribute("data-theme") || "dark";
  updateThemeToggleUI();

  function updateThemeToggleUI() {
    const isLight = theme === "light";
    themeToggle.setAttribute("aria-checked", String(isLight));
    themeToggle.classList.toggle("on", isLight);
  }

  themeToggle.addEventListener("click", () => {
    theme = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ravin_theme", theme);
    updateThemeToggleUI();
    playClick();
  });

  // ---------- Boot sequence ----------
  function runBootSequence() {
    const messages = ["INITIALIZING RAVIN", "LINKING NEURAL FIELD", "READY"];
    let i = 0;
    bootLine.textContent = messages[0];

    const interval = setInterval(() => {
      i++;
      if (i < messages.length) {
        bootLine.textContent = messages[i];
      }
      if (i >= messages.length) {
        clearInterval(interval);
        bootEl.classList.add("boot-done");
        appEl.classList.add("app-visible");
        setTimeout(() => bootEl.remove(), 600);
      }
    }, 480);
  }
  runBootSequence();

  // ---------- Sound (tiny synthesized blips, no audio files needed) ----------
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // iOS suspends new/backgrounded contexts until explicitly resumed inside
    // a user gesture — this call has to happen synchronously in the handler.
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playTone(freq, duration, peakGain) {
    if (!soundOn) return;
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(peakGain, ctx.currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Web Audio unsupported or blocked — fail silently, sound is a nicety.
    }
  }

  function playBlip(freq, duration) {
    playTone(freq, duration, 0.16);
  }

  function playClick() {
    playTone(1000, 0.045, 0.1);
  }

  function updateSoundToggleUI() {
    soundToggle.setAttribute("aria-checked", String(soundOn));
    soundToggle.classList.toggle("on", soundOn);
  }

  soundToggle.addEventListener("click", () => {
    soundOn = !soundOn;
    localStorage.setItem("ravin_sound", soundOn ? "on" : "off");
    updateSoundToggleUI();
    if (soundOn) playBlip(660, 0.09);
  });

  // ---------- Settings panel ----------
  settingsBtn.addEventListener("click", () => {
    settingsPanel.classList.toggle("open");
    playClick();
  });

  document.addEventListener("click", (e) => {
    if (
      settingsPanel.classList.contains("open") &&
      !settingsPanel.contains(e.target) &&
      !settingsBtn.contains(e.target)
    ) {
      settingsPanel.classList.remove("open");
    }
  });

  clearBtn.addEventListener("click", () => {
    chat.innerHTML = "";
    const fresh = document.createElement("div");
    fresh.className = "intro";
    fresh.innerHTML =
      '<p class="intro-line">RAVIN is listening.</p><p class="intro-sub">Ask it anything. It\'ll probably make a joke first.</p>';
    chat.appendChild(fresh);
    introEl = fresh;
    settingsPanel.classList.remove("open");
    playClick();
  });

  // ---------- Keyboard shortcuts ----------
  document.addEventListener("keydown", (e) => {
    const typingElsewhere =
      document.activeElement &&
      document.activeElement !== input &&
      document.activeElement.tagName === "INPUT";

    if (e.key === "/" && document.activeElement !== input && !typingElsewhere) {
      e.preventDefault();
      input.focus();
    }
    if (e.key === "Escape" && document.activeElement === input) {
      input.value = "";
    }
    if (e.key === "Escape") {
      settingsPanel.classList.remove("open");
    }
  });

  // ---------- Message rendering ----------
  function clearIntro() {
    if (introEl) {
      introEl.remove();
      introEl = null;
    }
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function addMessage(role, text) {
    clearIntro();

    const wrap = document.createElement("div");
    wrap.className = `msg ${role}`;

    const header = document.createElement("div");
    header.className = "msg-header";

    const label = document.createElement("span");
    label.className = "msg-label";
    label.textContent = role === "user" ? "You" : role === "error" ? "System" : "RAVIN";

    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = formatTime(new Date());

    header.appendChild(label);
    header.appendChild(time);

    const body = document.createElement("div");
    body.className = "msg-body";

    if (role === "ravin") {
      body.innerHTML = window.renderMarkdown(text);
    } else {
      body.textContent = text;
    }

    wrap.appendChild(header);
    wrap.appendChild(body);

    if (role === "ravin") {
      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-btn";
      copyBtn.type = "button";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = "Copied";
          setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
        });
      });
      wrap.appendChild(copyBtn);
    }

    chat.appendChild(wrap);
    chat.scrollTop = chat.scrollHeight;
    return { wrap, body };
  }

  function addTypingIndicator() {
    clearIntro();
    const wrap = document.createElement("div");
    wrap.className = "msg ravin typing";

    const header = document.createElement("div");
    header.className = "msg-header";
    const label = document.createElement("span");
    label.className = "msg-label";
    label.textContent = "RAVIN";
    header.appendChild(label);

    const body = document.createElement("div");
    body.className = "msg-body dots-anim";
    body.textContent = "thinking";

    wrap.appendChild(header);
    wrap.appendChild(body);
    chat.appendChild(wrap);
    chat.scrollTop = chat.scrollHeight;
    return wrap;
  }

  function setStatus(state) {
    statusDot.className = "status-dot";
    if (state === "thinking") {
      statusDot.classList.add("thinking");
      statusText.textContent = "THINKING";
    } else if (state === "error") {
      statusDot.classList.add("error");
      statusText.textContent = "ERROR";
    } else {
      statusText.textContent = "ONLINE";
    }
  }

  // ---------- Talk to Groq directly (no backend — this runs entirely client-side) ----------
  async function askGroq(apiKey, message) {
    let response;
    try {
      response = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: window.RAVIN_SYSTEM_PROMPT },
            { role: "user", content: message },
          ],
          temperature: 0.8,
        }),
      });
    } catch (networkErr) {
      throw new Error("Couldn't reach Groq's servers. Check your internet connection.");
    }

    if (!response.ok) {
      let details = "";
      try {
        const errBody = await response.json();
        details = errBody?.error?.message || JSON.stringify(errBody);
      } catch {
        details = await response.text().catch(() => "");
      }

      if (response.status === 401) {
        throw new Error("Groq rejected that API key (401). Double-check it in Settings.");
      }
      if (response.status === 429) {
        throw new Error("Hit Groq's rate limit (429). Wait a moment and try again.");
      }
      throw new Error(`Groq API error (${response.status}): ${details}`);
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;

    if (!reply) {
      throw new Error("Groq returned an empty or unexpected response.");
    }

    return reply.trim();
  }

  async function sendMessage(text) {
    const apiKey = getStoredKey();

    if (!apiKey) {
      addMessage("user", text);
      addMessage(
        "error",
        "Add a Groq API key in Settings (gear icon, top right) to start chatting — it's free and stays in your browser."
      );
      setStatus("error");
      openSettingsForKey();
      return;
    }

    addMessage("user", text);
    playBlip(420, 0.06);
    setStatus("thinking");
    sendBtn.disabled = true;

    const typingEl = addTypingIndicator();

    try {
      const reply = await askGroq(apiKey, text);
      typingEl.remove();
      addMessage("ravin", reply);
      playBlip(560, 0.08);
      setStatus("idle");
    } catch (err) {
      typingEl.remove();
      addMessage("error", err.message);
      setStatus("error");
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    sendMessage(text);
  });

  input.focus();
})();