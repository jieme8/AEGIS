#!/usr/bin/env node
/**
 * MCP Relay · J.A.R.V.I.S. Cyber Audio Spectrum
 *
 * 为什么需要它：浏览器无法直接 spawn stdio 型 MCP 服务器，也无法安全持有其凭据。
 * 因此所有真实 MCP 连接都发生在这个 Node 进程里。它用官方 SDK 作为 MCP client，
 * 连接 mcp.config.json 中声明的服务器（stdio / SSE），并暴露 HTTP 接口给浏览器
 * （经 Vite 同源代理 /api/mcp 转发）：
 *   GET  /api/mcp/list   -> 聚合所有已连接服务器的工具（扁平列表，每项带 server 字段）
 *   POST /api/mcp/call   -> { name, arguments } 按工具名路由到对应服务器执行
 *   GET  /api/mcp/health -> 健康自检（已连接服务器数 / 工具数）
 *   GET  /api/mcp/status -> 每个声明服务器的运行时状态（connected/disabled/error 等）与可用计数
 *
 * 安全约束：
 *   - 服务器定义只来自本地 mcp.config.json，前端永远不能传入 server 定义；
 *   - 凭据（如 SSE 的 Authorization）只存在于本进程与 .env，不进入前端 bundle；
 *   - 连接失败的服务器仅告警跳过，不影响其它服务器与基础对话（降级）。
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.resolve(ROOT, "mcp.config.json");

const log = (...a) => console.log("[mcp-relay]", ...a);
const warn = (...a) => console.warn("[mcp-relay]", ...a);

// 极简 .env 载入：把项目根 .env 的键值写入 process.env（仅当该键尚未存在），
// 以便把 TAVILY_API_KEY 等密钥注入给 stdio 子进程（MCP 服务器通常读环境变量取密钥）。
function loadDotEnv() {
  const envPath = path.resolve(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    const txt = fs.readFileSync(envPath, "utf-8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const k = m[1];
      let v = m[2];
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
    log("已从 .env 载入环境变量（供 MCP 子进程取密钥）");
  } catch (e) {
    warn("读取 .env 失败：", e.message);
  }
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    warn("未找到 mcp.config.json，使用默认空配置（仅 relay 启动，无服务器）。");
    return { relayPort: 8787, servers: [] };
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    cfg.relayPort = cfg.relayPort || 8787;
    cfg.servers = Array.isArray(cfg.servers) ? cfg.servers : [];
    return cfg;
  } catch (e) {
    warn("mcp.config.json 解析失败：", e.message);
    return { relayPort: 8787, servers: [] };
  }
}

// stdio 启动参数：Windows 下用 cmd /c 包裹，确保 npx/node 等 .cmd 入口被正确解析
function buildStdioParams(spec) {
  const base = { env: process.env, cwd: spec.cwd || ROOT };
  if (process.platform === "win32") {
    return { ...base, command: "cmd.exe", args: ["/c", spec.command, ...(spec.args || [])] };
  }
  return { ...base, command: spec.command, args: spec.args || [] };
}

async function connectServer(spec) {
  const client = new Client({ name: "jarvis-mcp-relay", version: "1.0.0" });
  let transport;
  if (spec.transport === "sse") {
    const headers = spec.headers || {};
    transport = new SSEClientTransport(new URL(spec.url), { headers });
  } else {
    transport = new StdioClientTransport(buildStdioParams(spec));
  }
  await client.connect(transport);
  const { tools } = await client.listTools();
  const norm = (tools || []).map((t) => ({
    name: t.name,
    description: t.description || "",
    inputSchema: t.inputSchema || { type: "object", properties: {} },
    server: spec.name,
  }));
  log(`已连接服务器 "${spec.name}"：${norm.length} 个工具`);
  return { name: spec.name, client, tools: norm };
}

// 全局连接表
let SERVERS = [];               // [{ name, client, tools }]
const NAME_TO_SERVER = new Map(); // tool name -> server
// 每个「声明」的服务器的运行时状态（含 disabled / error，避免被跳过后遗失）。
// 与 mcp.config.json 的 servers 一一对应，是 /api/mcp/status 的数据源。
let SERVER_STATES = [];        // [{ name, enabled, transport, status, toolCount, tools, error, latencyMs }]

async function initServers(config) {
  SERVER_STATES = [];
  for (const spec of config.servers) {
    const base = {
      name: spec.name,
      enabled: !!spec.enabled,
      transport: spec.transport || "stdio",
      status: "connecting",
      toolCount: 0,
      tools: [],
      error: null,
      latencyMs: null,
    };
    if (!spec.enabled) {
      base.status = "disabled";
      SERVER_STATES.push(base);
      log(`跳过未启用服务器 "${spec.name}"`);
      continue;
    }
    try {
      const t0 = Date.now();
      const s = await connectServer(spec);
      const dt = Date.now() - t0;
      SERVERS.push(s);
      for (const t of s.tools) {
        if (!NAME_TO_SERVER.has(t.name)) NAME_TO_SERVER.set(t.name, s);
      }
      SERVER_STATES.push({
        ...base,
        status: "connected",
        toolCount: s.tools.length,
        tools: s.tools.map((t) => t.name),
        latencyMs: dt,
      });
    } catch (e) {
      base.status = "error";
      base.error = e.message;
      SERVER_STATES.push(base);
      warn(`连接服务器 "${spec.name}" 失败，已跳过：`, e.message);
    }
  }
}

// 把工具 content 数组归一为字符串（MCP 返回的是 [{type:"text",text}...]）
function contentToString(content) {
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((c) => {
      if (c && c.type === "text") return c.text || "";
      if (c && c.type === "resource") return JSON.stringify(c.resource || c);
      return JSON.stringify(c);
    })
    .join("\n")
    .trim();
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 5 * 1024 * 1024) reject(new Error("请求体过大"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function handleList(res) {
  const tools = SERVERS.flatMap((s) => s.tools);
  sendJSON(res, 200, {
    servers: SERVERS.map((s) => ({ name: s.name, toolCount: s.tools.length })),
    tools,
  });
}

async function handleStatus(res) {
  const connected = SERVER_STATES.filter((s) => s.status === "connected").length;
  const disabled = SERVER_STATES.filter((s) => s.status === "disabled").length;
  const error = SERVER_STATES.filter((s) => s.status === "error").length;
  // 仅 status==="connected" 视为“可正常使用”（enabled && 已连 && 有工具）
  const usable = connected;
  sendJSON(res, 200, {
    ok: true,
    generatedAt: new Date().toISOString(),
    servers: SERVER_STATES,
    summary: { total: SERVER_STATES.length, connected, disabled, error, usable },
  });
}

async function handleCall(req, res) {
  let payload;
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (e) {
    return sendJSON(res, 400, { error: "无效的请求体：" + e.message });
  }
  const name = payload && payload.name;
  const args = (payload && payload.arguments) || {};
  if (!name) return sendJSON(res, 400, { error: "缺少工具名 name" });

  const server = NAME_TO_SERVER.get(name);
  if (!server) {
    return sendJSON(res, 404, {
      error: `未找到工具 "${name}"（可能服务器未启用或连接失败）`,
    });
  }
  try {
    const result = await server.client.callTool({ name, arguments: args });
    sendJSON(res, 200, {
      content: contentToString(result.content),
      isError: !!result.isError,
      structuredContent: result.structuredContent || null,
    });
  } catch (e) {
    warn(`执行工具 "${name}" 失败：`, e.message);
    sendJSON(res, 502, { error: "工具执行失败：" + e.message });
  }
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    try {
      if (req.method === "GET" && p === "/api/mcp/list") return await handleList(res);
      if (req.method === "POST" && p === "/api/mcp/call") return await handleCall(req, res);
      if (req.method === "GET" && p === "/api/mcp/health")
        return sendJSON(res, 200, {
          ok: true,
          servers: SERVERS.length,
          tools: SERVERS.reduce((n, s) => n + s.tools.length, 0),
        });
      if (req.method === "GET" && p === "/api/mcp/status") return await handleStatus(res);
      sendJSON(res, 404, { error: "未找到接口：" + p });
    } catch (e) {
      warn("请求处理异常：", e.message);
      sendJSON(res, 500, { error: e.message });
    }
  });
}

async function main() {
  loadDotEnv();
  const config = loadConfig();
  log("加载配置：", config.servers.length, "个服务器声明，relay 端口", config.relayPort);
  await initServers(config);
  const toolCount = SERVERS.reduce((n, s) => n + s.tools.length, 0);
  log("已连接", SERVERS.length, "个 MCP 服务器，共", toolCount, "个工具");

  const server = createServer();
  server.listen(config.relayPort, () => {
    log("Relay 已启动： http://localhost:" + config.relayPort);
    log("浏览器经 Vite 同源代理 /api/mcp 访问；本进程持有所有 MCP 连接与凭据。");
  });

  const shutdown = () => {
    log("正在关闭…");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[mcp-relay] 启动失败：", e);
  process.exit(1);
});
