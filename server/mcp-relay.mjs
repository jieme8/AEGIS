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
import { log } from "./lib/dev-log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.resolve(ROOT, "mcp.config.json");


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
    log.info("已从 .env 载入环境变量");
  } catch (e) {
    log.log.warn("读取 .env 失败：", e.message);
  }
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    log.log.warn("未找到 mcp.config.json，使用默认空配置（仅 relay 启动，无服务器）。");
    return { relayPort: 8787, servers: [] };
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    cfg.relayPort = cfg.relayPort || 8787;
    cfg.servers = Array.isArray(cfg.servers) ? cfg.servers : [];
    return cfg;
  } catch (e) {
    log.log.warn("mcp.config.json 解析失败：", e.message);
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
  log.ok(`已连接 ${spec.name}（${norm.length} 个工具）`);
  return { name: spec.name, client, tools: norm, toolCallTimeoutMs: spec.toolCallTimeoutMs || 60000 };
}

// 全局连接表
let SERVERS = [];               // [{ name, client, tools, toolCallTimeoutMs }]
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
      log.info(`跳过未启用的 ${spec.name}`);
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
      log.error(`连接 ${spec.name} 失败，已跳过：${e.message}`);
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

// ════════════════════════════════════════════════════════════════════════
// 聚合搜索 · 双源（Tavily + 百度 AI 搜索）并行 → 归一化去重 → 中文加权排序
// 对外暴露一个聚合工具 web_search：LLM 只调它即可一次拿到双源合体结果。
// ════════════════════════════════════════════════════════════════════════
const AGG_WEB_SEARCH = "web_search";
// 原始搜索工具（聚合后对前端隐藏，避免 LLM 乱选导致漏掉双源）
const HIDDEN_TOOLS = new Set(["tavily_search", "AIsearch"]);
// 聚合工具依赖的两个后端 server 名（对应 mcp.config.json 的 name）
const AGG_SOURCES = ["search", "baidu-ai-search"];

// 中文倾向的域名特征：命中任一即给该条显著提升权重
const CN_HOST_PATTERNS = [
  /\.cn$/i, /\bcn\b/i, /\.(com\.cn|org\.cn|gov\.cn|edu\.cn|net\.cn)$/i,
  /(^|\.)(baidu|zhihu|weibo|163|sina|qq|tencent|bilibili|douyin|xinhua|people|gmw|cctv|jschina|huanqiu|thepaper|yicai|caixin|ifeng|souhu|sohu|toutiao|jiqizhixin|csdn|cnblogs|oschina|geekbang)\./i,
];

function cnHostScore(host) {
  let s = 0;
  if (/\.cn$/i.test(host) || /\.cn\./.test(host)) s += 2;   // .cn 域名
  if (CN_HOST_PATTERNS.some((re) => re.test(host))) s += 2; // 国内知名站点
  return s;
}
function zhRatio(text) {
  if (!text) return 0;
  const zh = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const all = text.replace(/\s/g, "").length || 1;
  return zh / all;
}
function normalizeUrl(u) {
  try {
    const x = new URL(u);
    x.hash = "";
    x.search = "";
    return (x.hostname + x.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(u || "").trim().toLowerCase();
  }
}

const TITLE_RE = /^Title:\s*([\s\S]*?)(?=^\s*(?:ID|Content|URL|Title):\s*)/m;
const URL_RE = /^URL:\s*(\S+)/m;
const CONTENT_BEGIN_RE = /^Content:\s*/m;

function parseTavilyResults(text) {
  const items = [];
  const blocks = String(text || "").split(/\n(?=Title:\s)/g);
  for (const b of blocks) {
    const tm = b.match(TITLE_RE);
    const um = b.match(URL_RE);
    const cm = b.match(CONTENT_BEGIN_RE);
    if (!tm && !um) continue;
    let content = "";
    if (cm) content = b.slice(cm.index + cm[0].length).trim();
    const title = tm ? tm[1].trim().split(/\s+/).slice(0, 60).join(" ") : um[0].split("/")[2] || "";
    items.push({ title, url: um ? um[1].trim() : "", content, source: "tavily" });
  }
  return items;
}

function parseBaiduResults(text) {
  const items = [];
  // 以 "Title:" 作为段起点切块，块内再抽取 URL 行与 Content 部分
  const segments = String(text || "").split(/\n(?=Title:\s*)/g);
  for (const seg of segments) {
    const titleM = seg.match(/^Title:\s*(.*)/);
    if (!titleM) continue;
    const title = titleM[1].split(/\n/)[0].replace(/^[：:\s]+/, "").trim();
    const um = seg.match(/^URL:\s*(\S+)/m);
    // Content 从 "Content:" 之后取到块尾；若正文后紧跟独立的 "URL:" 行则截断到该行前
    let cm = seg.match(/^Content:\s*([\s\S]*)$/m);
    let content = "";
    if (cm) {
      let raw = cm[1];
      const cut = raw.search(/^\s*URL:\s*\S+/m);
      if (cut >= 0) raw = raw.slice(0, cut);
      content = raw.replace(/^\s+|\s+$/g, "");
    }
    items.push({
      title,
      url: um ? um[1].trim() : "",
      content,
      source: "baidu",
    });
  }
  return items;
}

// 并行调用两个源服务器；任一失败静默降级（用成功的那一方，仍保证聚合可用）
async function callSearchSource(server, name, args) {
  try {
    const r = await server.client.callTool({ name, arguments: args }, undefined, {
      timeout: server.toolCallTimeoutMs || 45000,
    });
    if (r && r.isError) return "";
    return contentToString(r ? r.content : null);
  } catch (e) {
    log.warn(`聚合搜索：来源 "${server.name}" 调用失败（降级）：`, e.message);
    return "";
  }
}

function cnOf(item) {
  try {
    return new URL(item.url).hostname;
  } catch {
    return "";
  }
}

/**
 * 聚合搜索主流程：
 * 1) 双源并行调用 tavily_search / AIsearch；
 * 2) 分别解析为 {title,url,content,source}；
 * 3) 按归一化 URL 去重（同源与异源重复均去）；URL 缺失按标题去重；
 * 4) 中文加权排序：.cn 域名 / 国内站点 / 中文内容占比较高者靠前，英文站降权；
 * 5) 输出统一文本（含来源标记），供 LLM 直接消费。
 */
async function runAggregatedSearch(args) {
  const query = String(args.query || args.q || "").trim();
  if (!query) return { error: "缺少查询 query" };

  const src = new Map();
  for (const s of SERVERS) if (AGG_SOURCES.includes(s.name)) src.set(s.name, s);

  const [tavilyTxt, baiduTxt] = await Promise.all([
    src.has("search")
      ? callSearchSource(src.get("search"), "tavily_search", { query })
      : Promise.resolve(""),
    src.has("baidu-ai-search")
      ? callSearchSource(src.get("baidu-ai-search"), "AIsearch", { query })
      : Promise.resolve(""),
  ]);

  let items = [];
  if (tavilyTxt) items = items.concat(parseTavilyResults(tavilyTxt));
  if (baiduTxt) items = items.concat(parseBaiduResults(baiduTxt));

  // 去重（URL 归一化；无 URL 时按标题归一化）
  const seen = new Map();
  for (const it of items) {
    const key = it.url ? normalizeUrl(it.url) : "t:" + String(it.title || "").trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, it);
  }
  items = [...seen.values()];

  // 中文加权排序
  for (const it of items) {
    const host = cnOf(it);
    const ratio = zhRatio(it.title + " " + it.content);
    // 中文内容为主 → +3；域名中文倾向 → host score；两加分叠加大于英文站
    it._score = (ratio >= 0.4 ? 3 : ratio >= 0.1 ? 1 : 0) + cnHostScore(host);
  }
  items.sort((a, b) => b._score - a._score);

  const engines = [];
  if (tavilyTxt) engines.push("Tavily");
  if (baiduTxt) engines.push("百度 AI 搜索");
  if (!tavilyTxt && !baiduTxt) engines.push("（双源均不可用）");

  const lines = [];
  lines.push(`聚合搜索结果 · 查询：${query}`);
  lines.push(`来源：${engines.join(" + ")}；原始 ${items.length + (seen.size ? 0 : 0)} 条已去重合并`);
  lines.push("");
  items.slice(0, 12).forEach((it, i) => {
    const tag = it.source === "baidu" ? "百度" : "Tavily";
    const host = cnOf(it);
    lines.push(`${i + 1}. [${tag}] ${it.title || "(无标题)"}`);
    if (it.url) lines.push(`   URL: ${it.url}`);
    const snip = String(it.content || "").replace(/\s+/g, " ").slice(0, 300);
    if (snip) lines.push(`   摘要: ${snip}`);
    if (host) lines.push(`   来源站: ${host}`);
    lines.push("");
  });
  if (items.length === 0) {
    lines.push("未获取到有效结果（两源均返回空）。");
  }

  const text = lines.join("\n").trim();
  return {
    content: text,
    metadata: {
      engines,
      total: items.length,
      tabs: {
        baidu: items.filter((x) => x.source === "baidu").length,
        tavily: items.filter((x) => x.source === "tavily").length,
      },
    },
  };
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
  // 聚合工具声明（前端直接展示给 LLM）
  const aggTool = {
    name: AGG_WEB_SEARCH,
    description:
      "聚合网页搜索（Tavily + 百度 AI 搜索双源并行）。查询一次即可同时获得英文与中文来源，已自动去重、优先中文站与中文内容。适合所有实时信息/新闻/事实/资料查询。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索查询关键词或自然语言问题" },
      },
      required: ["query"],
    },
    server: "web_search",
  };
  // 过滤掉被聚合隐藏的原始搜索工具，注入聚合工具
  const tools = SERVERS.flatMap((s) => s.tools).filter((t) => !HIDDEN_TOOLS.has(t.name));
  tools.unshift(aggTool);
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
  // 聚合搜索依赖的两个源服务器是否在线
  const aggSourcesOnline = AGG_SOURCES.filter((n) =>
    SERVER_STATES.some((s) => s.name === n && s.status === "connected")
  );
  sendJSON(res, 200, {
    ok: true,
    generatedAt: new Date().toISOString(),
    servers: SERVER_STATES.map((s) => ({
      ...s,
      hiddenTools: (s.tools || []).filter((t) => HIDDEN_TOOLS.has(t)),
    })),
    aggregate: {
      tool: AGG_WEB_SEARCH,
      description: "聚合网页搜索：Tavily + 百度 AI 搜索双源并行，自动去重、中文优先",
      hidden: [...HIDDEN_TOOLS],
      sources: AGG_SOURCES.map((name) => {
        const s = SERVER_STATES.find((st) => st.name === name);
        return { name, tools: s ? s.tools || [] : [] };
      }),
      onlineSources: aggSourcesOnline,
      available: aggSourcesOnline.length > 0,
    },
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

  // 聚合搜索：不走单服务器路由，直接执行双源合并
  if (name === AGG_WEB_SEARCH) {
    try {
      const agg = await runAggregatedSearch(args);
      if (agg.error) return sendJSON(res, 400, { error: agg.error });
      return sendJSON(res, 200, {
        content: agg.content,
        isError: false,
        structuredContent: agg.metadata || null,
      });
    } catch (e) {
      log.warn(`聚合搜索 "${name}" 失败：`, e.message);
      return sendJSON(res, 502, { error: "聚合搜索失败：" + e.message });
    }
  }

  const server = NAME_TO_SERVER.get(name);
  if (!server) {
    return sendJSON(res, 404, {
      error: `未找到工具 "${name}"（可能服务器未启用或连接失败）`,
    });
  }
  try {
    if (server.name === "memory") log.info(`⇢ ${name} @ memory`);
    const result = await server.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: server.toolCallTimeoutMs }
    );
    sendJSON(res, 200, {
      content: contentToString(result.content),
      isError: !!result.isError,
      structuredContent: result.structuredContent || null,
    });
  } catch (e) {
    log.warn(`执行工具 "${name}" 失败：`, e.message);
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
      log.warn("请求处理异常：", e.message);
      sendJSON(res, 500, { error: e.message });
    }
  });
}

async function main() {
  loadDotEnv();
  const config = loadConfig();
  log.info(`配置加载完成：${config.servers.length} 个服务器声明`);

  const server = createServer();
  server.listen(config.relayPort, () => {
    log.ready(`http://localhost:${config.relayPort}`);
  });

  await initServers(config);
  const toolCount = SERVERS.reduce((n, s) => n + s.tools.length, 0);
  log.ok(`全部就绪：${SERVERS.length} 个服务器，共 ${toolCount} 个工具`);

  const shutdown = () => {
    log.info("正在关闭…");
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
