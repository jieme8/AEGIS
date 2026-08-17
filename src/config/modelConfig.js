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
 * dev / prod：
 *   - LongCat 走同源代理 /api/longcat（密钥由代理注入、避免 CORS）。
 *   - 阿里默认走 https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions；
 *     可通过 VITE_QWEN_ENDPOINT 覆盖为其它 OpenAI 兼容端点（如 ModelScope token-plan）。
 *     dev 下走同源代理 /api/qwen 避免 CORS；prod 浏览器直连。
 */

const LONGCHAT_API_KEY =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_LONGCAT_API_KEY) ||
  "";

const IS_DEV =
  typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV;

export const LONGCAT_EP = IS_DEV
  ? "/api/longcat"
  : "https://api.longcat.chat/openai/v1/chat/completions";
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

// 阿里 Qwen 端点可覆盖：.env 给 OpenAI 兼容 base URL（不含 /chat/completions），
// 代码自动补全为完整 completions 地址；dev 下仍走 /api/qwen 代理。
const QWEN_BASE =
  envVal("VITE_QWEN_ENDPOINT") ||
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
const QWEN_EP = QWEN_BASE.replace(/\/+$/, "") + "/chat/completions";
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
          endpoint: IS_DEV ? "/api/qwen" : QWEN_EP,
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
