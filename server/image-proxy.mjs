// 生图 Proxy（provider=http 时使用）· 与 mcp-relay 同源范式
// 仅在 IMAGE_CONFIG.provider === "http" 时需要启动；默认 local 渲染器不依赖它。
//
// 启动：node server/image-proxy.mjs   （或在 package.json 里 `npm run genimg`）
// 前置：.env 中配置（服务端持有，绝不进前端）：
//   IMAGE_BASE_URL   生图 API 地址（如 https://apihub.agnes-ai.com/v1/images/generations）
//   IMAGE_API_KEY    生图密钥
//   IMAGE_MODEL      模型标识（如 agnes-image-2.1-flash）
//   PORT             监听端口（默认 8788）
//
// 行为：POST /api/genimg { prompt, negativePrompt, aspect, style }
//       → 转发到 IMAGE_BASE_URL（Agnes Image 2.1 Flash），注入密钥，
//       → 归一化返回 { url, model, id }
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// —— 轻量 .env 加载（不引入 dotenv 依赖，避免污染生产 bundle） ——
// 仅当进程环境里还没有这些变量时才从 .env 兜底读取（便于 standalone 运行）。
function loadDotEnv() {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) {
    console.warn("[image-proxy] .env 读取失败，忽略：", e.message);
  }
}
loadDotEnv();

const PORT = Number(process.env.PORT || 8788);
const BASE_URL = process.env.IMAGE_BASE_URL || "";
const API_KEY = process.env.IMAGE_API_KEY || "";
const MODEL = process.env.IMAGE_MODEL || "";

// 把前端传来的 aspect（如 "16:9"）映射为 Agnes 的 ratio；size 统一用档位 2K。
function toAgnesRatio(aspect) {
  const a = (aspect || "").trim();
  const allowed = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];
  return allowed.includes(a) ? a : "16:9";
}

const server = http.createServer(async (req, res) => {
  // 极简健康检查
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, provider: BASE_URL ? "http" : "unconfigured", model: MODEL || null }));
    return;
  }
  if (req.method !== "POST" || !req.url.startsWith("/api/genimg")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (!BASE_URL || !API_KEY) {
    res.writeHead(501, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "image provider 未配置（请设置 IMAGE_BASE_URL / IMAGE_API_KEY），或把 IMAGE_CONFIG.provider 改为 local）" }));
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  let payload = {};
  try { payload = JSON.parse(body || "{}"); } catch (e) { /* ignore */ }

  try {
    const upstream = await fetch(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + API_KEY },
      body: JSON.stringify({
        model: MODEL,
        prompt: payload.prompt,
        size: "2K",
        ratio: toAgnesRatio(payload.aspect),
        extra_body: { response_format: "url" },
      }),
    });
    const data = await upstream.json().catch(() => ({}));
    const first = data?.data?.[0] || {};
    const url = first.url || (first.b64_json ? `data:image/png;base64,${first.b64_json}` : null);
    if (!url) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "上游未返回图片", upstream: data }));
      return;
    }
    res.writeHead(upstream.ok ? 200 : upstream.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ url, model: MODEL, id: data?.created || data?.id || null, revised_prompt: first.revised_prompt || null }));
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (e && e.message) || "upstream failed" }));
  }
});

server.listen(PORT, () => {
  console.log(`[image-proxy] listening on http://localhost:${PORT} (provider: ${BASE_URL ? "http (" + MODEL + ")" : "unconfigured"})`);
});
