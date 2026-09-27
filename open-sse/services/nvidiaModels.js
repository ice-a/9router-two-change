/**
 * NVIDIA NIM live model catalog fetcher (#3398).
 *
 * NIM's `/v1/models` is a public OpenAI-shaped endpoint listing every hosted
 * service. The catalog rotates fast — models vanish (minimax/stepfun) and
 * appear (kimi-k3, glm-5.3) without the registry noticing — so /v1/models
 * serves the live list, filtered to chat-capable services, with a short TTL
 * cache. Requests ride the connection's proxy/relay config, because NIM is
 * exactly the upstream a free relay exists for.
 */

import { proxyAwareFetch } from "../utils/proxyFetch.js";

const NIM_MODELS_URL = "https://integrate.api.nvidia.com/v1/models";
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes — the catalog changes daily at most

/** @type {{ expiresAt: number, models: any[] } | null} */
let catalogCache = null;

// Mirrors the dashboard's suggested-models filter (single source of truth):
// /v1/models lists embedding, reward, safety, OCR/parse, ASR/TTS and
// similarity services too — none of them chat targets.
const NON_CHAT_NVIDIA = /embed|reward|safety|guard|retriever|parse|ocr|clip|deplot|kosmos|fuyu|diffusion|asr|speech|tts|fastpitch|riva|video-detector|calibration|neva|vila/i;

export function __resetNvidiaCatalogCacheForTests() {
  catalogCache = null;
}

export async function resolveNvidiaModels(credentials = {}, options = {}) {
  const { fetchFn = proxyAwareFetch, log = console, proxyOptions = null } = options;

  if (catalogCache && Date.now() < catalogCache.expiresAt) {
    return { models: catalogCache.models };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetchFn(NIM_MODELS_URL, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        // The endpoint is public today; sending the key keeps this working if
        // NVIDIA ever gates the catalog behind the developer plan.
        ...(credentials?.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {}),
      },
      signal: controller.signal,
    }, proxyOptions);
  } catch (error) {
    log?.warn?.(`NVIDIA live model fetch failed: ${error?.message || error}`);
    return { models: [], warning: error?.message || "fetch failed" };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    log?.warn?.(`NVIDIA live model fetch failed with status ${response.status}`);
    return { models: [], warning: `status ${response.status}` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return { models: [], warning: `invalid JSON: ${error?.message}` };
  }

  const ids = (Array.isArray(payload) ? payload : payload?.data || [])
    .map((m) => m?.id)
    .filter((id) => typeof id === "string" && id.trim() !== "" && !NON_CHAT_NVIDIA.test(id))
    .sort();

  const models = ids.map((id) => ({ id, name: id }));
  if (models.length > 0) {
    catalogCache = { expiresAt: Date.now() + CACHE_TTL_MS, models };
  }
  return { models };
}
