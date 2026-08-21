/**
 * Embedding 适配器：本地 Ollama（bge 中文向量模型）。
 *
 * 选型背景：LongCat 只提供聊天模型 LongCat-2.0（无 /v1/embeddings），
 * 云中转（token-plan、DashScope）也均无现成 key；改用本地 Ollama，
 * 离线可跑、无 key、中文语义好。
 *
 * API：POST {OLLAMA_URL}/api/embed
 *   请求 { model, input: [text...] }
 *   响应 { embeddings: [Float32Array..., ] }  // 顺序与 input 一致
 *
 * 配置源（均为可选，带默认值）：
 *   - OLLAMA_URL              默认 http://localhost:11434
 *   - OLLAMA_EMBED_MODEL      默认 quentinz/bge-small-zh-v1.5:latest
 *   - MEMORY_EMBED_TIMEOUT_MS 默认 30000（首次加载模型可能较慢）
 */

const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "quentinz/bge-small-zh-v1.5:latest";
const DEFAULT_TIMEOUT = 30000;

function getConfig() {
  return {
    url: rawUrl(process.env.OLLAMA_URL || DEFAULT_URL),
    model: process.env.OLLAMA_EMBED_MODEL || DEFAULT_MODEL,
    timeout: parseInt(process.env.MEMORY_EMBED_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT,
  };
}

// 去掉末尾斜杠，保证拼出 {url}/api/embed
function rawUrl(u) {
  return String(u || "").replace(/\/+$/, "");
}

export function getModel() {
  return getConfig().model;
}

export function getEmbedUrl() {
  return getConfig().url + "/api/embed";
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// 把 Ollama 的 embeddings 响应规范成 Float32Array 数组（按输入顺序）
function parseEmbedResponse(json) {
  if (!json || typeof json !== "object") {
    throw new Error("Ollama embedding 返回格式异常：非 JSON 对象");
  }
  if (json.error) {
    throw new Error(`Ollama embedding 错误：${String(json.error).slice(0, 300)}`);
  }
  const emb = json.embeddings;
  if (!Array.isArray(emb)) {
    throw new Error("Ollama embedding 返回缺少 embeddings 数组");
  }
  return emb.map((vec) => {
    if (!Array.isArray(vec) || vec.length === 0) {
      throw new Error("Ollama 返回的 embedding 为空或格式异常");
    }
    return new Float32Array(vec);
  });
}

function assertOllamaReachable(url, timeoutMs) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("仅支持 http(s)");
    }
  } catch (e) {
    throw new Error(`OLLAMA_URL 无效（${url}）：${e.message}`);
  }
}

export async function embedBatch(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const cfg = getConfig();
  assertOllamaReachable(cfg.url, cfg.timeout);
  const inputs = texts.map((t) => String(t ?? ""));

  const res = await fetchWithTimeout(
    cfg.url + "/api/embed",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model, input: inputs }),
    },
    cfg.timeout
  );

  // Ollama 空闲时模型未加载会返回连接拒绝；区分处理让错误更容易懂
  if (res.status === 404) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama 模型不存在（${cfg.model}）：${body.slice(0, 200)}。` +
        `可用 "ollama pull ${cfg.model}" 拉取，或用 OLLAMA_EMBED_MODEL 指定已安装模型。`
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Ollama embedding 返回 ${res.status} ${res.statusText}${body ? ": " + body.slice(0, 200) : ""}`
    );
  }

  const json = await res.json();
  return parseEmbedResponse(json);
}

export async function embedText(text) {
  const [vec] = await embedBatch([text]);
  return vec;
}

// 把一批记忆 value 映射成 embedding 后返回 [{ key, embedding }, ...]
export async function embedRecords(records) {
  if (!records.length) return [];
  const texts = records.map((r) => String(r.value ?? ""));
  const vectors = await embedBatch(texts);
  return records.map((r, i) => ({
    ...r,
    embedding: vectors[i] || null,
    embeddingSource: vectors[i] ? "ollama" : null,
  }));
}