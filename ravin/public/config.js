(() => {
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  const backendUrl = isLocal && location.port === "3000"
    ? location.origin
    : "https://ravin-hyeq.onrender.com";
  const supabaseUrl = "https://bzjudqhjrbwglxdfbkmj.supabase.co";

  window.RAVIN_CONFIG = Object.freeze({
    productName: "RAVIN",
    companyName: "Resonant Assist",
    release: "0.2.0",
    backendUrl,
    supabaseUrl,
    supabaseAnonKey: "sb_publishable_wVnTPMs0hUuWdt1_LGMIYQ_D-aXveMV",
    authUrl: `${supabaseUrl}/functions/v1/ravin-auth`,
    models: Object.freeze({
      conversation: Object.freeze({ label: "Granite", modeLabel: "Conversation" }),
      work: Object.freeze({ label: "Gemma", modeLabel: "Work" }),
    }),
  });
})();
