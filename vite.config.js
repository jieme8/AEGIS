import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 原地重构：保留原单页形态，仅将实现迁入 React 组件
export default defineConfig(({ mode }) => {
  // 从 .env 读取密钥（loadEnv 是 vite.config 中读取 .env 的可靠方式；
  // 顶层直接使用 process.env 时 Vite 尚未注入，会得到 undefined）
  const env = loadEnv(mode, process.cwd(), "");
  const LONGCHAT_API_KEY = env.VITE_LONGCAT_API_KEY || "";

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      // —— 同源代理：解决内置预览面板跨域 Origin 不匹配问题 ——
      // 浏览器只请求同源的 /api/longcat，不存在跨域；
      // Vite 服务端再把请求转发给 LongCat 并注入密钥，
      // 因此密钥不会下发到浏览器 bundle。
      proxy: {
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
              proxyReq.setHeader(
                "Authorization",
                `Bearer ${LONGCHAT_API_KEY}`
              );
            });
          },
        },
      },
    },
    build: {
      outDir: "dist",
    },
  };
});
