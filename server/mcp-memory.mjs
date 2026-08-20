#!/usr/bin/env node
/**
 * J.A.R.V.I.S. 自定义 MCP 服务器 · memory（跨会话记忆）
 *
 * 为什么自研：官方 `@modelcontextprotocol/server-memory` 在当前沙箱环境无法安装
 * （npm/npx 联网通道被挡，且 Windows 下 npx 的 bin 解析有坑）。本服务器仅依赖已安装的
 * `@modelcontextprotocol/sdk`，离线可跑，并完全可控。如需换回官方实现，把 mcp.config.json
 * 中 memory 的 command/args 改回 `npx -y @modelcontextprotocol/server-memory` 即可。
 *
 * 存储模型（记录数组，取代扁平 KV）：
 *   每条记忆 = { value, type, createdAt, updatedAt, accessCount, importance, scope }
 *   - type: semantic(用户/偏好/项目事实) | episodic(事件/交互) | procedural(反复出现的指令)
 *   - importance: 0~1，写入时可由 save_memory 指定，否则默认 0.5
 *   - scope: 命名空间（默认 "global"），为后续多项目隔离预留
 *   - 旧版扁平 { key: "字符串" } 在 loadStore 时自动迁移为记录，向后兼容。
 *
 * 提供的工具（持久化到用户主目录 ~/.jarvis-mcp/memory.json，跨会话保留）：
 *   save_memory(key, value, [type], [importance], [scope])  保存/覆盖一条记忆（记录模型）
 *   get_memory(key)                  读取一条记忆（不存在时返回提示），并记一次访问
 *   list_memories()                  列出全部记忆（key + value），用于回顾上下文
 *   delete_memory(key)               删除一条记忆
 *   search_memory(query, [types], [limit])  按关键词命中+时间衰减+重要性打分，返回 top-K
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

// 把任意旧值（字符串或已带部分字段的对象）规范成完整记录。
function migrateValue(v) {
  const t = Date.now();
  if (typeof v === "string") {
    return {
      value: v,
      type: "semantic",
      createdAt: t,
      updatedAt: t,
      accessCount: 0,
      importance: 0.5,
      scope: "global",
    };
  }
  const o = v && typeof v === "object" ? v : {};
  return {
    value: typeof o.value === "string" ? o.value : String(o.value ?? ""),
    type: o.type || "semantic",
    createdAt: o.createdAt || t,
    updatedAt: o.updatedAt || t,
    accessCount: o.accessCount || 0,
    importance: typeof o.importance === "number" ? o.importance : 0.5,
    scope: o.scope || "global",
  };
}

function loadStore() {
  const migrate = (obj) => {
    const out = {};
    for (const k of Object.keys(obj || {})) out[k] = migrateValue(obj[k]);
    return out;
  };
  const main = readJsonSafe(STORE_PATH);
  if (main !== undefined) return migrate(main); // 正常（含空文件），并迁移旧字符串值
  // 主文件损坏：尝试用备份恢复，避免记忆全丢
  process.stderr.write(`[mcp-memory] 主文件损坏，尝试从备份恢复\n`);
  const bak = readJsonSafe(BAK_PATH);
  if (bak !== undefined) {
    process.stderr.write(`[mcp-memory] 已从备份恢复 ${Object.keys(bak).length} 条记忆\n`);
    return migrate(bak);
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

// ============ 检索打分（search_memory 用） ============
function daysSince(ts) {
  if (!ts) return 9999;
  return Math.max(0, (Date.now() - ts) / 86400000);
}

// 把查询转成匹配单元：拉丁词（含下划线）+ 中文二元文法（bigram）。
// 中文无空格，整句当作单一 token 会子串匹配失败，故按字二元切分，
// 例如「用户语言」→ [用,户,语,言] 的相邻二元：用户/户语/语言，再与记忆值做包含匹配。
function ngrams(s) {
  const t = String(s || "").toLowerCase().replace(/\s+/g, "");
  const out = new Set();
  for (const m of t.match(/[a-z0-9_]+/g) || []) out.add(m); // 拉丁词（含下划线）
  const cjk = t.replace(/[a-z0-9_]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) out.add(cjk.slice(i, i + 2)); // 中文二元文法
  return [...out];
}

// 单字（unigram）匹配：用于短口语问句的回退召回，例如「我住哪里」里的「住」
// 可以命中「居住地址」。权重远低于 bigram，避免正常查询被噪声污染。
function unigrams(s) {
  const t = String(s || "").toLowerCase();
  const out = new Set();
  for (const ch of t) {
    if (/[\u4e00-\u9fa5a-z0-9]/.test(ch)) out.add(ch);
  }
  return [...out];
}

// 单条记录相对于查询词的相关性打分：
//   - 关键词命中（key 权重高、value 权重低）
//   - 时间衰减（updatedAt 越近越高，30 天半衰期）
//   - 重要性（importance）
//   - 访问频次（accessCount，轻微）
// 无任何关键词命中则返回 0（不召回），避免无关记忆污染上下文。
function scoreRecord(rec, key, grams, fullQ) {
  const value = String((rec && rec.value) || "").toLowerCase();
  const keyStr = String(key || "").toLowerCase();
  let kw = 0;
  for (const g of grams) {
    if (!g) continue;
    if (keyStr.includes(g)) kw += 3;
    if (value.includes(g)) kw += 1;
  }
  if (fullQ && (value.includes(fullQ.toLowerCase()) || keyStr.includes(fullQ.toLowerCase()))) {
    kw += 2;
  }
  if (kw <= 0) return 0;
  const recency = 1 / (1 + daysSince(rec.updatedAt) / 30); // 0~1
  const imp = typeof rec.importance === "number" ? rec.importance : 0.5;
  const access = Math.log((rec.accessCount || 0) + 1) * 0.1;
  return kw * (1 + imp) + recency * 0.5 + access;
}

// 回退打分：单字重叠。仅当 bigram 完全无命中时使用，权重很低，
// 主要解决「我住哪里」这种口语短问无法命中「居住地址」的问题。
function scoreRecordUnigram(rec, key, chars) {
  const value = String((rec && rec.value) || "").toLowerCase();
  const keyStr = String(key || "").toLowerCase();
  let hits = 0;
  for (const ch of chars) {
    if (!ch) continue;
    if (keyStr.includes(ch)) hits += 1.5;
    if (value.includes(ch)) hits += 0.5;
  }
  if (hits <= 0) return 0;
  const recency = 1 / (1 + daysSince(rec.updatedAt) / 30);
  const imp = typeof rec.importance === "number" ? rec.importance : 0.5;
  return hits * 0.35 * (1 + imp) + recency * 0.3;
}

const server = new Server(
  { name: "jarvis-memory", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "save_memory",
      description:
        "保存一条跨会话记忆（键值对，记录模型）。AI 可用它记住用户偏好、待办、上下文等，" +
        "下次对话仍能读取。key 已存在则覆盖并更新时间戳。可附带 type/importance/scope 元数据。",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "记忆键（唯一标识，如 'user_name'）" },
          value: { type: "string", description: "记忆内容" },
          type: {
            type: "string",
            enum: ["semantic", "episodic", "procedural"],
            description: "记忆类型：语义事实 / 情节事件 / 程序指令（默认 semantic）",
          },
          importance: { type: "number", description: "重要性 0~1，越高越优先召回（默认 0.5）" },
          scope: { type: "string", description: "命名空间（默认 global），为后续多项目隔离预留" },
        },
        required: ["key", "value"],
      },
    },
    {
      name: "get_memory",
      description: "按 key 读取一条记忆。不存在时返回未找到提示。会记录一次访问（影响召回排序）。",
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
      name: "search_memory",
      description:
        "检索与该查询相关的长期记忆。按关键词命中 + 时间衰减 + 重要性打分，返回 top-K。" +
        "供助手在回答前主动召回上下文，而非依赖 LLM 在工具循环里碰巧调用。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "用户的当前问题 / 话题，用于匹配记忆" },
          types: {
            type: "array",
            items: { type: "string", enum: ["semantic", "episodic", "procedural"] },
            description: "仅召回指定类型（可选）",
          },
          limit: { type: "number", description: "最多返回条数（默认 8，上限 30）" },
        },
        required: ["query"],
      },
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
        const t = Date.now();
        const prev = store[key];
        if (prev) {
          prev.value = value;
          prev.updatedAt = t;
          prev.accessCount = (prev.accessCount || 0) + 1;
          if (typeof a.type === "string" && a.type) prev.type = a.type;
          if (typeof a.importance === "number") prev.importance = a.importance;
          if (typeof a.scope === "string" && a.scope) prev.scope = a.scope;
        } else {
          store[key] = {
            value,
            type: typeof a.type === "string" && a.type ? a.type : "semantic",
            createdAt: t,
            updatedAt: t,
            accessCount: 0,
            importance: typeof a.importance === "number" ? a.importance : 0.5,
            scope: typeof a.scope === "string" && a.scope ? a.scope : "global",
          };
        }
        persist();
        return ok(`已保存记忆：${key}`);
      }
      case "get_memory": {
        const key = a.key;
        if (typeof key !== "string" || !key) return fail("缺少或无效的 key");
        if (!(key in store)) return ok(`未找到记忆：${key}`);
        const rec = store[key];
        rec.accessCount = (rec.accessCount || 0) + 1;
        rec.lastAccessedAt = Date.now();
        persist();
        return ok(`${key} = ${rec.value}`);
      }
      case "list_memories": {
        const keys = Object.keys(store);
        const entries = keys.map((k) => ({ key: k, value: store[k].value }));
        if (keys.length === 0) {
          return ok("（暂无记忆）", { entries: [] });
        }
        const lines = keys.map((k) => `• ${k} = ${store[k].value}`);
        // 同时给出结构化 entries，便于前端直接渲染成 key/value 表格
        return ok(`共 ${keys.length} 条记忆：\n` + lines.join("\n"), { entries });
      }
      case "search_memory": {
        const query = typeof a.query === "string" ? a.query : "";
        const limit = Math.min(Math.max(parseInt(a.limit, 10) || 8, 1), 30);
        const types = Array.isArray(a.types)
          ? a.types
          : typeof a.types === "string" && a.types
          ? [a.types]
          : null;
        if (!query.trim()) return ok("（未提供检索词）", { entries: [] });
        const fullQ = query.trim();
        const grams = ngrams(fullQ);
        const scored = [];
        for (const key of Object.keys(store)) {
          const rec = store[key];
          if (types && types.length && (!rec.type || !types.includes(rec.type))) continue;
          const sc = scoreRecord(rec, key, grams, fullQ);
          if (sc > 0) {
            rec.accessCount = (rec.accessCount || 0) + 1;
            rec.lastAccessedAt = Date.now();
            scored.push({
              key,
              value: rec.value,
              type: rec.type,
              score: Math.round(sc * 100) / 100,
            });
          }
        }
        // 回退：bigram 完全无命中时，用单字重叠再试一次，解决口语短问漏召回
        if (scored.length === 0) {
          const chars = unigrams(fullQ);
          for (const key of Object.keys(store)) {
            const rec = store[key];
            if (types && types.length && (!rec.type || !types.includes(rec.type))) continue;
            const sc = scoreRecordUnigram(rec, key, chars);
            if (sc > 0) {
              rec.accessCount = (rec.accessCount || 0) + 1;
              rec.lastAccessedAt = Date.now();
              scored.push({
                key,
                value: rec.value,
                type: rec.type,
                score: Math.round(sc * 100) / 100,
              });
            }
          }
        }
        scored.sort((x, y) => y.score - x.score);
        const top = scored.slice(0, limit);
        persist();
        if (!top.length) return ok(`未找到与「${fullQ}」相关的记忆`, { entries: [] });
        const lines = top.map(
          (e) => `• [${e.type}] ${e.key} = ${e.value} (score=${e.score})`
        );
        return ok(
          `命中 ${top.length} 条与「${fullQ}」相关的记忆：\n` + lines.join("\n"),
          { entries: top }
        );
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
