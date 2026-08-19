import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 网页查看器代理：前端 iframe 无法绕过目标站的 X-Frame-Options / CSP frame-ancestors
// （纯前端无解）。这里在服务端把页面抓回、剥掉帧屏蔽响应头后再喂给 iframe，
// 让 AI 回复里的网址能真正在应用内渲染（而非空白）。HTML 注入 <base> 让相对链接可解析。
// 仅用于本地 dev / preview（vite 中间件），生产静态部署无此端点。
function webProxyPlugin() {
  const handle = async (req, res, next) => {
    if (!req.url || !req.url.startsWith("/api/webproxy")) return next();
    let target = "";
    try {
      const u = new URL(req.url, "http://localhost");
      target = u.searchParams.get("url") || "";
    } catch {
      /* ignore */
    }
    if (!/^https?:\/\//i.test(target)) {
      res.statusCode = 400;
      res.end("invalid url");
      return;
    }
    try {
      const r = await fetch(target, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; JARVIS-WebProxy/1.0)" },
      });
      const buf = Buffer.from(await r.arrayBuffer());
      const ct = r.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", ct);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      // 关键：不转发 X-Frame-Options / CSP / frame-ancestors，iframe 才能嵌入
      if (ct.includes("text/html")) {
        let html = buf.toString("utf8");
        const baseTag = `<base href="${target}">`;
        if (/<head[^>]*>/i.test(html)) {
          html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
        } else if (/<html[^>]*>/i.test(html)) {
          html = html.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
        } else {
          html = baseTag + html;
        }
        // 兜底：清掉内联 CSP meta（frame-ancestors 多在响应头，这里再清内联）
        html = html.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "");
        res.end(Buffer.from(html, "utf8"));
      } else {
        res.end(buf);
      }
    } catch (e) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><html><body style="font-family:monospace;background:#0a0e16;color:#9fe;padding:16px">` +
        `代理获取失败：${String(e.message).replace(/[<>&]/g, "")}<br><br>` +
        `可点窗口标题栏的 ↗ 在浏览器中打开。</body></html>`
      );
    }
  };
  return {
    name: "web-proxy",
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

// 原地重构：保留原单页形态，仅将实现迁入 React 组件
export default defineConfig(({ mode }) => {
  // 从 .env 读取密钥（loadEnv 是 vite.config 中读取 .env 的可靠方式；
  // 顶层直接使用 process.env 时 Vite 尚未注入，会得到 undefined）
  const env = loadEnv(mode, process.cwd(), "");
  // 多 key 切换：从列表取首个作为「默认注入」兜底（仅当浏览器未自带 Authorization 时）
  const KEYS = (env.VITE_LONGCAT_API_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => p.split("@")[0].trim())
    .filter(Boolean);
  const LONGCHAT_API_KEY = env.VITE_LONGCAT_API_KEY || KEYS[0] || "";

  // Qwen/OpenAI 兼容端点可覆盖（默认 dashscope，支持 ModelScope token-plan 等）
  // .env 给 base URL（如 https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1）
  let QWEN_TARGET = "https://dashscope.aliyuncs.com";
  let QWEN_REWRITE_PATH = "/compatible-mode/v1/chat/completions";
  try {
    const qwenBaseRaw = (env.VITE_QWEN_ENDPOINT || "").replace(/\/+$/, "");
    const qwenBase = qwenBaseRaw || "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const qwenUrl = new URL(qwenBase);
    QWEN_TARGET = `${qwenUrl.protocol}//${qwenUrl.host}`;
    QWEN_REWRITE_PATH = qwenUrl.pathname + "/chat/completions";
  } catch (e) {
    console.warn(
      "[vite] VITE_QWEN_ENDPOINT 解析失败，/api/qwen 代理回退默认 dashscope：",
      e.message
    );
  }

  // 同源代理配置（dev / preview 共用同一份）：解决内置预览面板跨域 Origin 不匹配问题。
  // 浏览器只请求同源的 /api/*，不存在跨域；Vite 服务端再转发并（按需）注入密钥，
  // 密钥不会下发到浏览器 bundle。token-plan / dashscope 等阿里端点不返回 CORS 头，
  // 因此 vite preview（打包产物 import.meta.env.DEV=false）也必须走同源代理，
  // 否则浏览器直连会被 CORS 拦截，表现为「供应商突然不能用了」。
  const apiProxy = {
    "/api/longcat": {
      target: "https://api.longcat.chat",
      changeOrigin: true,
      secure: true, // 校验证书（LongCat 证书有效）
      rewrite: (p) =>
        p.replace(/^\/api\/longcat/, "/openai/v1/chat/completions"),
      configure: (proxy) => {
        if (!LONGCHAT_API_KEY) {
          console.warn(
            "[vite] 未找到 VITE_LONGCAT_API_KEY，/api/longcat 代理将以空密钥转发，LongCat 会返回 401。"
          );
        }
        proxy.on("proxyReq", (proxyReq) => {
          // 浏览器切换 key 时会自带 Authorization（选中密钥），
          // 此时透传、不覆盖；仅当浏览器未带（旧单密钥流程）才注入默认密钥。
          const incoming = proxyReq.getHeader("authorization");
          if (!incoming) {
            proxyReq.setHeader(
              "Authorization",
              `Bearer ${LONGCHAT_API_KEY}`
            );
          }
        });
      },
    },
    // —— 阿里千问 CodePlan 同源代理：浏览器走 /api/qwen（避免 CORS），
    // 密钥由浏览器自带 Authorization（选中供应商的 key），代理透传、不覆盖。
    // target / rewrite 由 VITE_QWEN_ENDPOINT 动态解析，支持自定义 OpenAI 兼容端点。
    "/api/qwen": {
      target: QWEN_TARGET,
      changeOrigin: true,
      secure: true,
      rewrite: () => QWEN_REWRITE_PATH,
    },
    // —— MCP Relay 同源代理：浏览器只请求同源 /api/mcp，由 Vite 转发到
    // Node 侧 MCP Relay（默认 8787），避免在浏览器暴露 MCP 服务器凭据。
    // 注意：转发完整路径（不剥离 /api/mcp 前缀），因为 Relay 的路由本身就是
    // /api/mcp/list | /call | /health | /status。若在此剥离前缀，Relay 会收到
    // /list 等裸路径而返回 404（此前浏览器侧 MCP 全链路因此失效）。
    "/api/mcp": {
      target: "http://localhost:8787",
      changeOrigin: true,
      secure: true,
    },
    // —— 影视搜索同源代理：浏览器走 /api/moviesearch（免 CORS），
    // 由 Node 侧 movie-search.mjs（默认 8789）持有对外抓取能力，密钥绝不进前端 bundle。
    "/api/moviesearch": {
      target: "http://localhost:8789",
      changeOrigin: true,
      secure: true,
    },
    // —— 影视元数据检索同源代理：浏览器走 /api/movie（免 CORS），
    // 由 Node 侧 movie-meta.mjs（默认 8790）持有元数据检索能力，与现有 8789 完全隔离。
    "/api/movie": {
      target: "http://localhost:8790",
      changeOrigin: true,
      secure: true,
    },
    // —— 油价同源代理：浏览器走 /api/oil（免 CORS），由 Node 侧 oilApi.mjs
    // （默认 8795）抓取「油价网」全国 92# 汽油真实零售价，密钥/抓取逻辑绝不进前端 bundle。
    "/api/oil": {
      target: "http://localhost:8795",
      changeOrigin: true,
      secure: true,
    },
    // —— 生图同源代理：provider=http 时浏览器走 /api/genimg（免 CORS），
    // 密钥由 image-proxy（Node 侧，默认 8788）持有，绝不进前端 bundle。
    // 默认 local 渲染器不命中此代理；切 http 时才需启动 image-proxy。
    "/api/genimg": {
      target: "http://localhost:8788",
      changeOrigin: true,
      secure: true,
    },
  };

  return {
    plugins: [react(), webProxyPlugin()],
    server: {
      host: true,
      port: 5173,
      proxy: apiProxy,
    },
    // —— 预览构建同样需要同源代理：打包产物 import.meta.env.DEV=false，
    // 供应商端点会被写成完整直连 URL，浏览器直连 token-plan 会撞 CORS（其不返回 ACAO 头）。
    // 复用同一套 apiProxy，让 vite preview 也走同源代理。
    preview: {
      port: 4173,
      proxy: apiProxy,
    },
    build: {
      outDir: "dist",
    },
  };
});
