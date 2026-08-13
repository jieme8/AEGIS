import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 原地重构：保留原单页形态，仅将实现迁入 React 组件
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
});
