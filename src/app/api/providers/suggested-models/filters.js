// Free OpenCode models that don't use the "-free" id suffix
const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

// Upstream returns "Model is unavailable" for this id (2026-09-02) — re-enable when fixed
const DEAD_FREE_OPENCODE_MODELS = new Set(["deepseek-v4-flash-free"]);

// NVIDIA NIM's /v1/models lists every hosted service — embedding, reward,
// safety, OCR/parse, ASR/TTS and similarity models are not chat targets.
const NON_CHAT_NVIDIA = /embed|reward|safety|guard|retriever|parse|ocr|clip|deplot|kosmos|fuyu|diffusion|asr|speech|tts|fastpitch|riva|video-detector|calibration|neva|vila/i;

export const FILTERS = {
  // NVIDIA NIM: plain OpenAI {data:[{id}]} catalog (public endpoint, #3398)
  "nvidia": (models) =>
    (Array.isArray(models) ? models : [])
      .map((m) => ({ id: m.id, name: m.id }))
      .filter((m) => m.id && !NON_CHAT_NVIDIA.test(m.id))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),

  "openrouter-free": (models) =>
    models
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          m.context_length >= 200000
      )
      .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
      .sort((a, b) => b.contextLength - a.contextLength),

  "opencode-free": (models) =>
    models
      .filter((m) => (m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id)) && !DEAD_FREE_OPENCODE_MODELS.has(m.id))
      .map((m) => ({ id: m.id, name: m.id })),

  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo"))
      .map((m) => ({ id: m.id, name: m.name || m.id })),

  "airforce-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => (m.tier === "free" || m.id?.endsWith(":free")) && m.supports_chat === true && (!m.media_type || m.media_type === "chat" || m.media_type === "text"))
      .map((m) => ({ id: m.id, name: m.name || m.id, contextLength: m.context_length }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
};
