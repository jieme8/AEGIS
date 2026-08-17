// 生图 Proxy（provider=http 时使用）· 与 mcp-relay 同源范式
// 仅在 IMAGE_CONFIG.provider === "http" 时需要启动；默认 local 渲染器不依赖它。
//
// 启动：node server/image-proxy.mjs   （或在 package.json 里 `npm run genimg`）
// 前置：.env 中配置（服务端持有，绝不进前端）。每个供应商一组：
//   Agnes:     IMAGE_BASE_URL / IMAGE_API_KEY / IMAGE_MODEL
//   SenseNova: SENSENOVA_BASE_URL / SENSENOVA_API_KEY / SENSENOVA_MODEL
//   （新增供应商：在下方 PROVIDERS 里补一个适配器即可）
//   PORT             监听端口（默认 8788）
//
// 行为：POST /api/genimg { provider, prompt, negativePrompt, aspect, style }
//       → 按 body.provider 选择供应商（默认 agnes），注入对应密钥，
//       → 由该供应商的 buildBody/parse 适配器完成请求塑形与响应归一化，
//       → 归一化返回 { url, model, id, provider }
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

// 把前端传来的 aspect（如 "16:9"）映射为 Agnes 的 ratio；size 统一用档位 2K。
function toAgnesRatio(aspect) {
  const a = (aspect || "").trim();
  const allowed = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];
  return allowed.includes(a) ? a : "16:9";
}

// 把 aspect 映射为 SenseNova 允许的 size（其接口只接受这一组固定档位）。
const SIZE_MAP = {
  "1:1": "2048x2048",
  "16:9": "2752x1536",
  "9:16": "1536x2752",
  "4:3": "2368x1760",
  "3:4": "1760x2368",
  "3:2": "2496x1664",
  "2:3": "1664x2496",
  "21:9": "3072x1376",
};
function toSize(aspect) {
  const a = (aspect || "").trim();
  return SIZE_MAP[a] || "2752x1536";
}

// 多生图供应商适配器：每个供应商一组 base/key/model + 请求塑形(buildBody) + 响应解析(parse)。
// 前端在 body.provider 里指定用哪个；密钥永远只在服务端，绝不下发到浏览器。
const PROVIDERS = {
  agnes: {
    label: "Agnes Image 2.1 Flash",
    base: process.env.IMAGE_BASE_URL,
    key: process.env.IMAGE_API_KEY,
    model: process.env.IMAGE_MODEL,
    // Agnes 专属格式：size="2K" + ratio + extra_body.response_format
    buildBody: (p) => ({
      model: PROVIDERS.agnes.model,
      prompt: p.prompt,
      size: "2K",
      ratio: toAgnesRatio(p.aspect),
      extra_body: { response_format: "url" },
    }),
    parse: (d) => {
      const f = d?.data?.[0] || {};
      return f.url || (f.b64_json ? `data:image/png;base64,${f.b64_json}` : null);
    },
  },
  sensenova: {
    label: "SenseNova U1 Fast",
    base: process.env.SENSENOVA_BASE_URL,
    key: process.env.SENSENOVA_API_KEY,
    model: process.env.SENSENOVA_MODEL,
    // OpenAI 兼容 images 接口：n + size(WxH) + response_format
    buildBody: (p) => ({
      model: PROVIDERS.sensenova.model,
      prompt: p.prompt,
      n: 1,
      size: toSize(p.aspect),
      response_format: "url",
    }),
    parse: (d) => {
      const f = d?.data?.[0] || {};
      return f.url || (f.b64_json ? `data:image/png;base64,${f.b64_json}` : null);
    },
  },
};

function configuredProviders() {
  return Object.entries(PROVIDERS)
    .filter(([, p]) => p.base && p.key)
    .map(([id, p]) => ({ id, label: p.label, model: p.model }));
}

const server = http.createServer(async (req, res) => {
  // 极简健康检查：回报已配置的供应商列表
  if (req.method === "GET" && req.url === "/health") {
    const list = configuredProviders();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, providers: list, active: list[0]?.id || null }));
    return;
  }
  if (req.method !== "POST" || !req.url.startsWith("/api/genimg")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  let payload = {};
  try { payload = JSON.parse(body || "{}"); } catch (e) { /* ignore */ }

  // 按 body.provider 选择供应商（默认 agnes）
  const providerId = payload.provider && PROVIDERS[payload.provider] ? payload.provider : "agnes";
  const prov = PROVIDERS[providerId];
  if (!prov || !prov.base || !prov.key) {
    res.writeHead(501, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: `image provider "${providerId}" 未配置（请在 .env 设置对应 BASE_URL / API_KEY / MODEL），或把 IMAGE_CONFIG.provider 改为 local`,
      })
    );
    return;
  }

  try {
    const upstream = await fetch(prov.base, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + prov.key },
      body: JSON.stringify(prov.buildBody(payload)),
    });
    const data = await upstream.json().catch(() => ({}));
    const url = prov.parse(data);
    if (!url) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "上游未返回图片", upstream: data }));
      return;
    }
    res.writeHead(upstream.ok ? 200 : upstream.status, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        url,
        model: prov.model,
        id: data?.created || data?.id || null,
        revised_prompt: data?.data?.[0]?.revised_prompt || null,
        provider: providerId,
      })
    );
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (e && e.message) || "upstream failed" }));
  }
});

server.listen(PORT, () => {
  const names = configuredProviders().map((p) => p.label).join(" / ") || "unconfigured";
  console.log(`[image-proxy] listening on http://localhost:${PORT} (providers: ${names})`);
});
