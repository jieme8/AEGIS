#!/usr/bin/env node
/**
 * J.A.R.V.I.S. 自定义 MCP 服务器 · memory（跨会话记忆）
 *
 * 为什么自研：官方 `@modelcontextprotocol/server-memory` 在当前沙箱环境无法安装
 * （npm/npx 联网通道被挡，且 Windows 下 npx 的 bin 解析有坑）。本服务器仅依赖已安装的
 * `@modelcontextprotocol/sdk`，离线可跑，并完全可控。如需换回官方实现，把 mcp.config.json
 * 中 memory 的 command/args 改回 `npx -y @modelcontextprotocol/server-memory` 即可。
 *
 * 提供的工具（KV 记忆，持久化到用户主目录 ~/.jarvis-mcp/memory.json，跨会话保留）：
 *   save_memory(key, value)          保存/覆盖一条记忆
 *   get_memory(key)                  读取一条记忆（不存在时返回提示）
 *   list_memories()                  列出全部记忆（key + value）
 *   delete_memory(key)               删除一条记忆
 *
 * 注意：stdio 模式，JSON-RPC 走 stdout；日志走 stderr，互不污染。
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 记忆文件：存放在「用户主目录」下，而非项目根。
// 原因：项目根在 vite 的 watch 范围内，Windows 上 chokidar 会锁住该文件，
// 导致 relay 子进程写入时 EPERM；放到项目外既避开该锁，也不污染仓库，跨会话/跨项目都稳。
const STORE_DIR = path.join(os.homedir(), ".jarvis-mcp");
const STORE_PATH = path.join(STORE_DIR, "memory.json");
const BAK_PATH = path.join(STORE_DIR, "memory.json.bak");

function ensureDir() {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  } catch (e) {
    process.stderr.write(`[mcp-memory] 创建记忆目录失败：${e.message}\n`);
  }
}

function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return null; // 文件不存在
    const txt = fs.readFileSync(p, "utf-8");
    if (!txt.trim()) return {}; // 空文件视为空记忆，不抛错
    const obj = JSON.parse(txt);
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) {
    process.stderr.write(`[mcp-memory] 读取 ${p} 失败：${e.message}\n`);
    return undefined; // 表示「损坏/不可用」，与「不存在(null)」「空({})」区分
  }
}

function loadStore() {
  const main = readJsonSafe(STORE_PATH);
  if (main !== undefined) return main; // 正常（含空文件）
  // 主文件损坏：尝试用备份恢复，避免记忆全丢
  process.stderr.write(`[mcp-memory] 主文件损坏，尝试从备份恢复\n`);
  const bak = readJsonSafe(BAK_PATH);
  if (bak !== undefined) {
    process.stderr.write(`[mcp-memory] 已从备份恢复 ${Object.keys(bak).length} 条记忆\n`);
    return bak;
  }
  return {};
}

let store = loadStore();

// 持久化：先备份当前有效主文件到 .bak，再直接落盘。
// 用「备份 + 直写」而非「临时文件→unlink→rename」：后者在沙箱/Windows 下 rename
// 覆盖已存在文件会 EPERM/卡住；直写在 relay（dangerouslyDisableSandbox）环境下稳定可用。
// .bak 保证：即便某次直写被中断导致主文件损坏（如 0 字节），下次加载可从 .bak 恢复，
// 不会整段记忆丢失。
function persist() {
  ensureDir();
  // 1) 备份当前有效主文件
  try {
    if (fs.existsSync(STORE_PATH)) {
      const cur = fs.readFileSync(STORE_PATH, "utf-8");
      if (cur.trim()) {
        JSON.parse(cur); // 校验有效性
        fs.copyFileSync(STORE_PATH, BAK_PATH);
      }
    }
  } catch (e) {
    process.stderr.write(`[mcp-memory] 备份失败（忽略）：${e.message}\n`);
  }
  // 2) 直写主文件
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
  } catch (e) {
    process.stderr.write(`[mcp-memory] 写入主文件失败：${e.message}\n`);
    // 写入失败：尝试用备份救回主文件
    try { if (fs.existsSync(BAK_PATH)) fs.copyFileSync(BAK_PATH, STORE_PATH); } catch (_) {}
  }
}

const server = new Server(
  { name: "jarvis-memory", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "save_memory",
      description:
        "保存一条跨会话记忆（键值对）。AI 可用它记住用户偏好、待办、上下文等，" +
        "下次对话仍能读取。key 已存在则覆盖。",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "记忆键（唯一标识，如 'user_name'）" },
          value: { type: "string", description: "记忆内容" },
        },
        required: ["key", "value"],
      },
    },
    {
      name: "get_memory",
      description: "按 key 读取一条记忆。不存在时返回未找到提示。",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string", description: "记忆键" } },
        required: ["key"],
      },
    },
    {
      name: "list_memories",
      description: "列出全部已保存的记忆（key 与 value），用于回顾上下文。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "delete_memory",
      description: "按 key 删除一条记忆。",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string", description: "记忆键" } },
        required: ["key"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params || {};
  const a = args || {};
  try {
    switch (name) {
      case "save_memory": {
        const key = a.key, value = a.value;
        if (typeof key !== "string" || !key) return fail("缺少或无效的 key");
        if (typeof value !== "string") return fail("value 必须是字符串");
        store[key] = value;
        persist();
        return ok(`已保存记忆：${key}`);
      }
      case "get_memory": {
        const key = a.key;
        if (typeof key !== "string" || !key) return fail("缺少或无效的 key");
        if (!(key in store)) return ok(`未找到记忆：${key}`);
        return ok(`${key} = ${store[key]}`);
      }
      case "list_memories": {
        const keys = Object.keys(store);
        const entries = keys.map((k) => ({ key: k, value: store[k] }));
        if (keys.length === 0) {
          return ok("（暂无记忆）", { entries: [] });
        }
        const lines = keys.map((k) => `• ${k} = ${store[k]}`);
        // 同时给出结构化 entries，便于前端直接渲染成 key/value 表格
        return ok(`共 ${keys.length} 条记忆：\n` + lines.join("\n"), { entries });
      }
      case "delete_memory": {
        const key = a.key;
        if (typeof key !== "string" || !key) return fail("缺少或无效的 key");
        if (!(key in store)) return ok(`未找到记忆，无需删除：${key}`);
        delete store[key];
        persist();
        return ok(`已删除记忆：${key}`);
      }
      default:
        return fail(`未知工具：${name}`);
    }
  } catch (e) {
    return fail((e && e.message) || String(e));
  }
});

function ok(text, structured) {
  const obj = { content: [{ type: "text", text }], isError: false };
  if (structured !== undefined) obj.structuredContent = structured;
  return obj;
}
function fail(text) {
  return { content: [{ type: "text", text }], isError: true };
}

const transport = new StdioServerTransport();
await server.connect(transport);
