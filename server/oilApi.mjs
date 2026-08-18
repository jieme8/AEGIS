#!/usr/bin/env node
/**
 * 油价同源代理 · J.A.R.V.I.S. Cyber Audio Spectrum
 *
 * 浏览器经 Vite 同源代理 /api/oil 访问本服务（默认 :8795），由本进程在 Node 侧
 * 抓取「油价网」并解析出真实 92# 汽油零售指导价，规避浏览器 CORS 且不让抓取逻辑进前端 bundle。
 *
 * 接口： GET /api/oil            成功：200 JSON（见 oilPrice.mjs getOilPrice 结构）
 *                                失败：502 JSON { ok:false, error }
 *        GET /api/oil/health     健康检查
 * 端口： OIL_PORT（默认 8795），由 Vite 同源代理 /api/oil 转发。
 */

import http from "node:http";
import { getOilPrice } from "./oilPrice.mjs";

const PORT = Number(process.env.OIL_PORT) || 8795;
const log = (...a) => console.log("[oil-api]", ...a);
const warn = (...a) => console.warn("[oil-api]", ...a);

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

async function handleOil(_req, res) {
  try {
    const data = await getOilPrice();
    sendJSON(res, 200, data);
  } catch (e) {
    warn("抓取油价失败：", e.message);
    sendJSON(res, 502, { ok: false, error: e.message || String(e) });
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/api/oil/health") {
        return sendJSON(res, 200, { ok: true, service: "oil-api", ts: new Date().toISOString() });
      }
      if (req.method === "GET" && url.pathname === "/api/oil") {
        return await handleOil(req, res);
      }
      sendJSON(res, 404, { error: "未找到接口：" + url.pathname });
    } catch (e) {
      warn("请求处理异常：", e.message);
      sendJSON(res, 500, { error: e.message });
    }
  });
}

const server = createServer();
server.listen(PORT, () => {
  log("油价代理已启动： http://localhost:" + PORT);
  log("浏览器经 Vite 同源代理 /api/oil 访问；本进程执行真实油价抓取 + 解析。");
});

const shutdown = () => {
  log("正在关闭…");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
