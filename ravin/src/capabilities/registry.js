const ENVIRONMENTS = Object.freeze({
  desktop: {
    id: "desktop",
    name: "Desktop",
    description: "Full RAVIN chat/workstation environment.",
    senses: ["text_input", "file_input", "image_input", "display"],
    actions: ["text_response", "file_analysis", "image_analysis"],
    connectedSystems: ["ravin_chat"],
  },
  phone: {
    id: "phone",
    name: "Phone",
    description: "Touch-first mobile RAVIN environment.",
    senses: ["text_input", "camera_upload", "photo_upload", "file_input", "display"],
    actions: ["text_response", "file_analysis", "image_analysis"],
    connectedSystems: ["ravin_chat"],
  },
  portable_core: {
    id: "portable_core",
    name: "Portable Core",
    description: "Future carried RAVIN Core with wearable accessories.",
    senses: ["microphone", "camera", "device_state"],
    actions: ["earpiece_audio", "status_feedback"],
    connectedSystems: ["core", "earpiece", "wearable_camera"],
    simulated: true,
  },
  relay: {
    id: "relay",
    name: "Relay",
    description: "Future RAVIN embedded inside Resonant Relay.",
    senses: ["relay_tasks", "relay_calendar", "relay_notes", "relay_messages"],
    actions: ["relay_task_proposal", "relay_schedule_proposal", "relay_assistance"],
    connectedSystems: ["resonant_relay"],
    simulated: true,
  },
  vehicle: {
    id: "vehicle",
    name: "Vehicle Dock",
    description: "Future hands-free RAVIN vehicle environment.",
    senses: ["microphone", "gps", "vehicle_telemetry", "obd_diagnostics"],
    actions: ["voice_response", "navigation_guidance", "hud_status"],
    connectedSystems: ["vehicle_dock", "obd_interface", "hud"],
    simulated: true,
    safety: ["No dense or distracting UI while driving", "Vehicle-control actions are not available in the simulator"],
  },
  garage: {
    id: "garage",
    name: "Garage Dock",
    description: "Future workshop environment for RAVIN.",
    senses: ["microphone", "workshop_camera", "tool_state"],
    actions: ["voice_response", "display_instructions"],
    connectedSystems: ["garage_dock", "workshop_display"],
    simulated: true,
    safety: ["Physical machinery requires explicit authorization and hardware safety interlocks"],
  },
});

export function listCapabilityEnvironments() {
  return Object.values(ENVIRONMENTS).map((environment) => ({ ...environment }));
}

export function resolveCapabilityEnvironment(value) {
  const key = String(value || "desktop").trim().toLowerCase();
  return ENVIRONMENTS[key] || ENVIRONMENTS.desktop;
}

export function capabilityContext(value) {
  const env = resolveCapabilityEnvironment(value);
  const lines = [
    `CURRENT RAVIN ENVIRONMENT: ${env.name} (${env.id})`,
    `Available senses: ${env.senses.join(", ") || "none"}.`,
    `Available actions: ${env.actions.join(", ") || "none"}.`,
    `Connected systems: ${env.connectedSystems.join(", ") || "none"}.`,
  ];
  if (env.simulated) lines.push("This is a software simulation. Do not claim physical hardware is actually connected.");
  if (env.safety?.length) lines.push(`Environment constraints: ${env.safety.join("; ")}.`);
  lines.push("Only claim capabilities listed above and actually implemented by the current software request.");
  return lines.join("\n");
}
