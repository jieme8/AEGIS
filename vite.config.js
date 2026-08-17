import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

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
    plugins: [react()],
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
