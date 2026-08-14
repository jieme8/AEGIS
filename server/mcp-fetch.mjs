#!/usr/bin/env node
/**
 * J.A.R.V.I.S. 自定义 MCP 服务器 · fetch（联网抓取）
 *
 * 为什么自研：官方 `@modelcontextprotocol/server-fetch` 在当前 npm registry 不可用
 * （404），而第三方 `mcp-server-fetch@0.0.2` 老旧不可靠。本服务器仅依赖已安装的
 * `@modelcontextprotocol/sdk`，离线可跑，且完全可控。如需替换为官方实现，只需把
 * mcp.config.json 中 fetch 的 command/args 换回 `npx -y @modelcontextprotocol/server-fetch`。
 *
 * 提供的工具：
 *   fetch(url, [method], [headers], [body], [maxChars]) -> 返回 HTTP 状态 + 响应文本
 *     （默认裁剪到 8000 字符，避免大页面撑爆上下文）。
 *
 * 注意：运行在 stdio 模式，所有 JSON-RPC 走 stdout；日志走 stderr，互不污染。
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const MAX_CHARS_DEFAULT = 8000;
const FETCH_TIMEOUT_MS = 20000;

const server = new Server(
  { name: "jarvis-fetch", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "fetch",
      description:
        "抓取指定 URL 的网页或公开 API 内容，返回 HTTP 状态与响应文本（默认裁剪到 8000 字符）。" +
        "用于联网查询实时信息：新闻、文档、公开接口数据等。",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "目标 URL，须以 http:// 或 https:// 开头" },
          method: { type: "string", enum: ["GET", "POST"], default: "GET", description: "请求方法" },
          headers: { type: "object", description: "可选请求头（键值对）" },
          body: { type: "string", description: "POST 请求体（可选）" },
          maxChars: { type: "number", description: "返回内容最大字符数，默认 8000" },
        },
        required: ["url"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params || {};
  if (name !== "fetch") {
    return { content: [{ type: "text", text: `未知工具：${name}` }], isError: true };
  }
  const url = args && args.url;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { content: [{ type: "text", text: "缺少或无效的 url（须以 http:// 或 https:// 开头）" }], isError: true };
  }

  try {
    const init = { method: (args.method || "GET").toUpperCase(), headers: (args.headers) || {} };
    if (args.body) init.body = args.body;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(timer);

    const raw = await res.text();
    const max = Number.isFinite(args.maxChars) ? args.maxChars : MAX_CHARS_DEFAULT;
    const clipped =
      raw.length > max ? raw.slice(0, max) + `\n…(已截断，原文共 ${raw.length} 字符)` : raw;

    return {
      content: [{ type: "text", text: `HTTP ${res.status} ${res.statusText}\n\n${clipped}` }],
      isError: false,
    };
  } catch (e) {
    const msg = e && e.name === "AbortError" ? `请求超时（${FETCH_TIMEOUT_MS}ms）` : (e && e.message) || String(e);
    return { content: [{ type: "text", text: "fetch 失败：" + msg }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
