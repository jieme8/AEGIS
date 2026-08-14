import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 原地重构：保留原单页形态，仅将实现迁入 React 组件
export default defineConfig({
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
        rewrite: (p) => p.replace(/^\/api\/longcat/, "/openai/v1/chat/completions"),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader(
              "Authorization",
              "Bearer ak_2jJ7rL9fb9re8xg22J4Vu26H6RY6k"
            );
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
