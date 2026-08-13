(function () {
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

  let soundOn =
    localStorage.getItem("ravin_sound") === "on";

  updateSoundToggleUI();

  /*
   * API keys are now handled by the Node server.
   *
   * Keep the existing settings controls visually harmless
   * in case the current HTML still contains them.
   */
  if (apiKeyInput) {
    apiKeyInput.value = "";
    apiKeyInput.disabled = true;
    apiKeyInput.placeholder =
      "Configured on the RAVIN server";
  }

  if (saveKeyBtn) {
    saveKeyBtn.disabled = true;
    saveKeyBtn.style.display = "none";
  }

  if (keyStatus) {
    keyStatus.textContent = "Server-side";
    keyStatus.classList.add("key-status-ok");
  }

  // ---------- Theme ----------
  let theme =
    document.documentElement.getAttribute(
      "data-theme"
    ) || "dark";

  updateThemeToggleUI();

  function updateThemeToggleUI() {
    if (!themeToggle) {
      return;
    }

    const isLight = theme === "light";

    themeToggle.setAttribute(
      "aria-checked",
      String(isLight)
    );

    themeToggle.classList.toggle(
      "on",
      isLight
    );
  }

  if (themeToggle) {
    themeToggle.addEventListener(
      "click",
      () => {
        theme =
          theme === "light"
            ? "dark"
            : "light";

        document.documentElement.setAttribute(
          "data-theme",
          theme
        );

        localStorage.setItem(
          "ravin_theme",
          theme
        );

        updateThemeToggleUI();
        playClick();
      }
    );
  }

  // ---------- Boot ----------
  function runBootSequence() {
    if (!bootEl || !bootLine || !appEl) {
      return;
    }

    const messages = [
      "INITIALIZING RAVIN",
      "LINKING NEURAL FIELD",
      "AGENT SYSTEM ONLINE",
      "READY",
    ];

    let i = 0;

    bootLine.textContent = messages[0];

    const interval = setInterval(() => {
      i++;

      if (i < messages.length) {
        bootLine.textContent = messages[i];
      }

      if (i >= messages.length - 1) {
        clearInterval(interval);

        setTimeout(() => {
          bootEl.classList.add(
            "boot-done"
          );

          appEl.classList.add(
            "app-visible"
          );

          setTimeout(() => {
            bootEl.remove();
          }, 600);
        }, 250);
      }
    }, 480);
  }

  runBootSequence();

  // ---------- Sound ----------
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (
        window.AudioContext ||
        window.webkitAudioContext
      )();
    }

    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    return audioCtx;
  }

  function playTone(
    freq,
    duration,
    peakGain
  ) {
    if (!soundOn) {
      return;
    }

    try {
      const ctx =
        getAudioContext();

      const osc =
        ctx.createOscillator();

      const gain =
        ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(
        0.0001,
        ctx.currentTime
      );

      gain.gain.exponentialRampToValueAtTime(
        peakGain,
        ctx.currentTime + 0.008
      );

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + duration
      );

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(
        ctx.currentTime + duration
      );
    } catch {
      // Audio is optional.
    }
  }

  function playBlip(
    freq,
    duration
  ) {
    playTone(
      freq,
      duration,
      0.16
    );
  }

  function playClick() {
    playTone(
      1000,
      0.045,
      0.1
    );
  }

  function updateSoundToggleUI() {
    if (!soundToggle) {
      return;
    }

    soundToggle.setAttribute(
      "aria-checked",
      String(soundOn)
    );

    soundToggle.classList.toggle(
      "on",
      soundOn
    );
  }

  if (soundToggle) {
    soundToggle.addEventListener(
      "click",
      () => {
        soundOn = !soundOn;

        localStorage.setItem(
          "ravin_sound",
          soundOn ? "on" : "off"
        );

        updateSoundToggleUI();

        if (soundOn) {
          playBlip(660, 0.09);
        }
      }
    );
  }

  // ---------- Settings ----------
  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener(
      "click",
      () => {
        settingsPanel.classList.toggle(
          "open"
        );

        playClick();
      }
    );

    document.addEventListener(
      "click",
      (event) => {
        if (
          settingsPanel.classList.contains(
            "open"
          ) &&
          !settingsPanel.contains(
            event.target
          ) &&
          !settingsBtn.contains(
            event.target
          )
        ) {
          settingsPanel.classList.remove(
            "open"
          );
        }
      }
    );
  }

  if (clearBtn) {
    clearBtn.addEventListener(
      "click",
      () => {
        chat.innerHTML = "";

        const fresh =
          document.createElement(
            "div"
          );

        fresh.className = "intro";

        fresh.innerHTML =
          '<p class="intro-line">RAVIN is listening.</p><p class="intro-sub">Ask it anything. It can now work with its own codebase.</p>';

        chat.appendChild(fresh);

        introEl = fresh;

        if (settingsPanel) {
          settingsPanel.classList.remove(
            "open"
          );
        }

        playClick();
      }
    );
  }

  // ---------- Keyboard ----------
  document.addEventListener(
    "keydown",
    (event) => {
      const typingElsewhere =
        document.activeElement &&
        document.activeElement !== input &&
        document.activeElement.tagName ===
          "INPUT";

      if (
        event.key === "/" &&
        document.activeElement !== input &&
        !typingElsewhere
      ) {
        event.preventDefault();
        input.focus();
      }

      if (
        event.key === "Escape" &&
        document.activeElement === input
      ) {
        input.value = "";
      }

      if (event.key === "Escape") {
        settingsPanel?.classList.remove(
          "open"
        );
      }
    }
  );

  // ---------- Message rendering ----------
  function clearIntro() {
    if (introEl) {
      introEl.remove();
      introEl = null;
    }
  }

  function formatTime(date) {
    return date.toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  }

  function addMessage(
    role,
    text
  ) {
    clearIntro();

    const wrap =
      document.createElement(
        "div"
      );

    wrap.className =
      `msg ${role}`;

    const header =
      document.createElement(
        "div"
      );

    header.className =
      "msg-header";

    const label =
      document.createElement(
        "span"
      );

    label.className =
      "msg-label";

    label.textContent =
      role === "user"
        ? "You"
        : role === "error"
          ? "System"
          : "RAVIN";

    const time =
      document.createElement(
        "span"
      );

    time.className =
      "msg-time";

    time.textContent =
      formatTime(new Date());

    header.appendChild(label);
    header.appendChild(time);

    const body =
      document.createElement(
        "div"
      );

    body.className =
      "msg-body";

    if (
      role === "ravin" &&
      window.renderMarkdown
    ) {
      body.innerHTML =
        window.renderMarkdown(text);
    } else {
      body.textContent = text;
    }

    wrap.appendChild(header);
    wrap.appendChild(body);

    if (role === "ravin") {
      const copyBtn =
        document.createElement(
          "button"
        );

      copyBtn.className =
        "copy-btn";

      copyBtn.type = "button";
      copyBtn.textContent = "Copy";

      copyBtn.addEventListener(
        "click",
        () => {
          navigator.clipboard
            .writeText(text)
            .then(() => {
              copyBtn.textContent =
                "Copied";

              setTimeout(() => {
                copyBtn.textContent =
                  "Copy";
              }, 1200);
            })
            .catch(() => {});
        }
      );

      wrap.appendChild(copyBtn);
    }

    chat.appendChild(wrap);
    chat.scrollTop =
      chat.scrollHeight;

    return {
      wrap,
      body,
    };
  }

  function addTypingIndicator() {
    clearIntro();

    const wrap =
      document.createElement(
        "div"
      );

    wrap.className =
      "msg ravin typing";

    const header =
      document.createElement(
        "div"
      );

    header.className =
      "msg-header";

    const label =
      document.createElement(
        "span"
      );

    label.className =
      "msg-label";

    label.textContent =
      "RAVIN";

    header.appendChild(label);

    const body =
      document.createElement(
        "div"
      );

    body.className =
      "msg-body dots-anim";

    body.textContent =
      "thinking";

    wrap.appendChild(header);
    wrap.appendChild(body);

    chat.appendChild(wrap);
    chat.scrollTop =
      chat.scrollHeight;

    return wrap;
  }

  function setStatus(state) {
    if (!statusDot || !statusText) {
      return;
    }

    statusDot.className =
      "status-dot";

    if (state === "thinking") {
      statusDot.classList.add(
        "thinking"
      );

      statusText.textContent =
        "THINKING";
    } else if (
      state === "error"
    ) {
      statusDot.classList.add(
        "error"
      );

      statusText.textContent =
        "ERROR";
    } else {
      statusText.textContent =
        "ONLINE";
    }
  }

  // ---------- Backend communication ----------
  async function askRavin(message) {
    let response;

    try {
      response = await fetch(
        "/api/chat",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            message,
          }),
        }
      );
    } catch {
      throw new Error(
        "Couldn't reach the RAVIN server. Make sure the Node server is running."
      );
    }

    let data = {};

    try {
      data = await response.json();
    } catch {
      throw new Error(
        `RAVIN server returned an invalid response (${response.status}).`
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.error ||
          `RAVIN server error (${response.status}).`
      );
    }

    if (
      !data?.reply ||
      typeof data.reply !== "string"
    ) {
      throw new Error(
        "RAVIN returned an empty response."
      );
    }

    return data;
  }

  async function sendMessage(text) {
    addMessage(
      "user",
      text
    );

    playBlip(420, 0.06);

    setStatus("thinking");

    sendBtn.disabled = true;

    const typingEl =
      addTypingIndicator();

    try {
      const result =
        await askRavin(text);

      typingEl.remove();

      addMessage(
        "ravin",
        result.reply
      );

      playBlip(560, 0.08);

      setStatus("idle");
    } catch (error) {
      typingEl.remove();

      addMessage(
        "error",
        error.message
      );

      setStatus("error");
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  if (form) {
    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();

        const text =
          input.value.trim();

        if (!text) {
          return;
        }

        input.value = "";

        sendMessage(text);
      }
    );
  }

  input?.focus();
})();