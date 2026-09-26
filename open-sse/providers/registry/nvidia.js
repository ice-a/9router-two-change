export default {
  id: "nvidia",
  priority: 20,
  hasFree: true,
  alias: "nvidia",
  display: {
    name: "NVIDIA NIM",
    icon: "developer_board",
    color: "#76B900",
    textIcon: "NV",
    website: "https://developer.nvidia.com/nim",
    notice: {
      text: "Free access for NVIDIA Developer Program members (prototyping & testing).",
      apiKeyUrl: "https://build.nvidia.com/settings/api-keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    validateUrl: "https://integrate.api.nvidia.com/v1/models",
    // #2311/#2610: NVIDIA rejects Anthropic's client_metadata with
    // "Validation: Unsupported parameter(s): `client_metadata`".
    quirks: { dropClientMetadata: true },
  },
  // #3398: the NIM catalog rotates fast (minimax/stepfun entries vanished,
  // kimi-k3 / glm-5.3 / nemotron-3.5 appeared) — pull the live list for the
  // dashboard model picker and let users type any current id directly.
  modelsFetcher: { url: "https://integrate.api.nvidia.com/v1/models", type: "nvidia" },
  passthroughModels: true,
  models: [
    // Curated defaults — verified live against /v1/models (2026-09-26).
    { id: "moonshotai/kimi-k3", name: "Kimi K3" },
    { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6" },
    { id: "z-ai/glm-5.3", name: "GLM 5.3" },
    { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
    { id: "deepseek-ai/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra" },
    { id: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super" },
    { id: "nvidia/nemotron-3.5-lightning-30b-a3b", name: "Nemotron 3.5 Lightning" },
    { id: "nvidia/nemotron-nano-3-30b-a3b", name: "Nemotron Nano 3" },
    { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", name: "Nemotron 3 Nano Omni" },
    { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1", name: "Llama Nemotron Ultra 253B" },
    { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B" },
    { id: "meta/muse-glimmer-30b", name: "Muse Glimmer 30B" },
    { id: "meta/llama-3.2-90b-vision-instruct", name: "Llama 3.2 90B Vision" },
    { id: "mistralai/mistral-nemotron", name: "Mistral Nemotron" },
    { id: "nvidia/llama-3.2-nv-embedqa-1b-v1", name: "NV EmbedQA 1B v1", kind: "embedding" },
    { id: "nvidia/parakeet-ctc-1.1b-asr", name: "Parakeet CTC 1.1B", params: ["language"], kind: "stt" },
    { id: "fastpitch", name: "FastPitch", kind: "tts" },
    { id: "tacotron2", name: "Tacotron2", kind: "tts" },
  ],
  serviceKinds: ["llm","tts","embedding"],
  ttsConfig: {
    baseUrl: "https://integrate.api.nvidia.com/v1/audio/speech",
    authType: "apikey",
    authHeader: "bearer",
    format: "nvidia-tts",
  },
  embeddingConfig: { baseUrl: "https://integrate.api.nvidia.com/v1/embeddings", authType: "apikey", authHeader: "bearer" },
};
