/*
 * 供应商配置 · 多模型 / 多 API 地址切换
 * 支持在同一界面切换不同供应商（如 LongCat、阿里千问 CodePlan），
 * 每个供应商自带 endpoint / apiKey / model / 过期日，切换即用。
 *
 * 接入方式（.env，均需 VITE_ 前缀才能进浏览器 bundle）：
 *   1) 便捷模式（推荐）：
 *      VITE_LONGCAT_API_KEYS=key1,key2@2026-09-01   # LongCat 多 key（可 @过期日）
 *      VITE_QWEN_API_KEY=sk-ws-xxx                  # 阿里千问 CodePlan
 *      VITE_QWEN_MODEL=qwen-coder-plus              # 可选，默认 qwen-coder-plus
 *      VITE_QWEN_ENDPOINT=https://.../compatible-mode/v1  # 可选，默认 dashscope
 *      VITE_QWEN_EXPIRES=2026-12-31                 # 可选过期日
 *   2) 高级模式（完全自定义 endpoint / model）：
 *      VITE_PROVIDERS=[{"label":"...","endpoint":"https://.../chat/completions",
 *                       "key":"...","model":"...","expiresAt":"2026-09-01"}]
 *      （一旦设置 VITE_PROVIDERS，便捷模式的自动配置被忽略，以 JSON 为准）
 *
 * dev / preview（vite 同源代理）：
 *   - LongCat 始终走同源代理 /api/longcat（密钥由代理注入、避免 CORS）。
 *   - 阿里始终走同源代理 /api/qwen（密钥由浏览器自带 Authorization，代理透传）。
 *     target / rewrite 由 VITE_QWEN_ENDPOINT 动态解析（默认 dashscope，
 *     可覆盖为 ModelScope token-plan 等 OpenAI 兼容端点）。
 *   - 注意：vite preview 现在也复用同一套代理（server.proxy 与 preview.proxy 一致），
 *     否则打包产物中 endpoint 为完整直连 URL，浏览器直连会被 CORS 拦截。
 *   - 真实 prod 静态部署需在前置代理层配置 /api/* 转发到对应后端。
 */

const LONGCHAT_API_KEY =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_LONGCAT_API_KEY) ||
  "";

const IS_DEV =
  typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV;

// 始终走同源代理 /api/longcat（dev + preview 共用同一套 vite 代理）。
// 阿里/token-plan 不返回 CORS 头，且 prod 直连会把密钥暴露在浏览器；
// 因此本地 dev 与 vite preview 都经代理转发，真实部署需在前置代理层配置 /api/* 转发。
export const LONGCAT_EP = "/api/longcat";
function envVal(name) {
  return typeof import.meta !== "undefined" && import.meta.env
    ? import.meta.env[name]
    : undefined;
}
function envList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// 阿里 Qwen 的完整 base URL 仅由 vite.config 的 /api/qwen 代理解析使用（见 VITE_QWEN_ENDPOINT），
// 浏览器侧统一走同源代理 /api/qwen，不再需要在前端拼出完整直连地址。
function parseExpiry(v) {
  if (!v) return null;
  const s = String(v).trim();
  const t = new Date(s.length <= 10 ? s + "T23:59:59" : s).getTime();
  return isNaN(t) ? null : t;
}
function normalizeProfile(p, i) {
  return {
    id: p.id || "p" + i,
    label: p.label || "PROVIDER " + (i + 1),
    endpoint: p.endpoint || LONGCAT_EP,
    apiKey: (p.key || "").trim(),
    model: p.model || "LongCat-2.0",
    expiresAt: parseExpiry(p.expiresAt),
    supportsTools: p.supportsTools !== undefined ? !!p.supportsTools : true,
  };
}

function parseProviders() {
  // 高级：完整 JSON（endpoint / model / key / expiresAt 全自定义）
  const rawJson = envVal("VITE_PROVIDERS");
  if (rawJson) {
    try {
      const arr = JSON.parse(rawJson);
      if (Array.isArray(arr) && arr.length) return arr.map(normalizeProfile);
    } catch (e) {
      console.warn("[modelConfig] VITE_PROVIDERS 解析失败，回退便捷模式：", e);
    }
  }
  // 便捷：LongCat（多 key / 单 key）+ 可选阿里 CodePlan
  const profiles = [];
  const lcKeys = envList(envVal("VITE_LONGCAT_API_KEYS"));
  if (lcKeys.length) {
    lcKeys.forEach((part) => {
      const [k, exp] = part.split("@");
      profiles.push(
        normalizeProfile(
          {
            label: envVal("VITE_LONGCAT_LABEL") || ("LongCat-" + (profiles.length + 1)),
            endpoint: LONGCAT_EP,
            key: (k || "").trim(),
            model: "LongCat-2.0",
            expiresAt: exp ? exp.trim() : null,
          },
          profiles.length
        )
      );
    });
  } else if (LONGCHAT_API_KEY) {
    profiles.push(
      normalizeProfile(
        { label: "LongCat-1", endpoint: LONGCAT_EP, key: LONGCHAT_API_KEY, model: "LongCat-2.0" },
        profiles.length
      )
    );
  }
  const qwenKey = envVal("VITE_QWEN_API_KEY");
  if (qwenKey) {
    profiles.push(
      normalizeProfile(
        {
          label: envVal("VITE_QWEN_LABEL") || "阿里TokenPlan",
          // 始终走同源代理 /api/qwen（dev + preview 一致）。
          // 阿里 token-plan / dashscope 不返回 CORS 头，浏览器直连会被拦截；
          // 经 vite 同源代理转发则无跨域问题。真实 prod 部署需前置代理配置 /api/*。
          endpoint: "/api/qwen",
          key: qwenKey.trim(),
          model: envVal("VITE_QWEN_MODEL") || "qwen-coder-plus",
          expiresAt: envVal("VITE_QWEN_EXPIRES") || null,
        },
        profiles.length
      )
    );
  }
  return profiles;
}

export const PROFILES = parseProviders();

export const MODEL_CONFIG = {
  provider: "multi",
  // —— MCP 工具调用（Agent 能力，详见 MCP-INTEGRATION-PLAN.md）——
  supportsTools: true,
  toolsEnabled: true,
  mcpRelay: "/api/mcp",
  maxToolIterations: 5,
  maxTokens: 2000,
  temperature: 0.7,
  timeoutMs: 30000,
  fallbackToLocal: true,
};
