#!/usr/bin/env node
/**
 * J.A.R.V.I.S. 自定义 MCP 服务器 · memory（跨会话记忆）
 *
 * 存储模型：SQLite + 向量 embedding
 *   - 数据库：项目根 memory_db/memory.db（node:sqlite，零依赖）
 *   - 向量来源：本地 Ollama bge 中文模型（bge-small-zh-v1.5，离线无 key）
 *   - 检索：向量 cosine × 0.5 + 关键词 × 0.3 + 时间衰减 × 0.1 + 重要性 × 0.05 + 访问 × 0.01
 *
 * 工具签名保持与旧版一致：save/get/list/search/delete。
 *
 * 向后兼容：启动时若发现旧版 ~/.jarvis-mcp 数据且项目 memory_db/ 为空，自动迁移并保留备份。
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  openDb,
  closeDb,
  upsertMemory,
  getMemory,
  touchMemory,
  listMemories,
  deleteMemory,
  getAllMemories,
  isDbInitialized,
  legacyJsonExists,
  readLegacyJson,
  normalizeLegacyRecord,
  bulkInsert,
  markLegacyMigrated,
  restoreLegacyFromMigration,
} from "./memory/store.mjs";
import { embedText, embedRecords } from "./memory/embed.mjs";
import { searchMemories } from "./memory/search.mjs";

// 启动时一次性迁移旧 JSON（如失败则保留 JSON，下次重试）
async function tryMigrateLegacy() {
  if (isDbInitialized() || !legacyJsonExists()) return;
  try {
    process.stderr.write("[mcp-memory] 检测到旧版 JSON，开始迁移到 SQLite…\n");
    openDb();
    const legacy = readLegacyJson();
    const keys = Object.keys(legacy || {});
    if (keys.length === 0) {
      markLegacyMigrated();
      process.stderr.write("[mcp-memory] 旧 JSON 为空，已跳过\n");
      return;
    }

    const records = keys.map((k) => normalizeLegacyRecord(k, legacy[k]));
    // 批量生成 embedding；失败直接抛错，不写入
    const withEmbeddings = await embedRecords(records);
    bulkInsert(withEmbeddings);
    markLegacyMigrated();
    process.stderr.write(`[mcp-memory] 已迁移 ${keys.length} 条记忆到 SQLite\n`);
  } catch (e) {
    restoreLegacyFromMigration();
    process.stderr.write(`[mcp-memory] 迁移失败（保留原 JSON）：${e.message}\n`);
  }
}

const server = new Server(
  { name: "jarvis-memory", version: "3.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "save_memory",
      description:
        "保存一条跨会话记忆。AI 用它记住用户偏好、待办、上下文等。key 已存在则覆盖。" +
        "会先调用 LongCat embedding 服务生成向量，失败时不存储。",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "记忆键（唯一标识，如 'user_name'）" },
          value: { type: "string", description: "记忆内容" },
          type: {
            type: "string",
            enum: ["semantic", "episodic", "procedural"],
            description: "记忆类型（默认 semantic）",
          },
          importance: { type: "number", description: "重要性 0~1（默认 0.5）" },
          scope: { type: "string", description: "命名空间（默认 global）" },
        },
        required: ["key", "value"],
      },
    },
    {
      name: "get_memory",
      description: "按 key 读取一条记忆，不存在时返回提示。会记录一次访问。",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string", description: "记忆键" } },
        required: ["key"],
      },
    },
    {
      name: "list_memories",
      description: "列出全部已保存的记忆（key 与 value）。",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "search_memory",
      description:
        "检索相关长期记忆。按向量相似度 + 关键词命中 + 时间衰减 + 重要性返回 top-K。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "用户当前问题 / 话题" },
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
        const key = a.key;
        const value = a.value;
        if (typeof key !== "string" || !key) return fail("缺少或无效的 key");
        if (typeof value !== "string") return fail("value 必须是字符串");

        // 先生成 embedding，失败直接报错，不存储
        const embedding = await embedText(value);
        const type = typeof a.type === "string" && a.type ? a.type : "semantic";
        const importance = typeof a.importance === "number" ? a.importance : 0.5;
        const scope = typeof a.scope === "string" && a.scope ? a.scope : "global";

        upsertMemory({
          key,
          value,
          type,
          importance,
          scope,
          embedding,
          embeddingSource: "ollama",
        });
        return ok(`已保存记忆：${key}`);
      }
      case "get_memory": {
        const key = a.key;
        if (typeof key !== "string" || !key) return fail("缺少或无效的 key");
        const rec = getMemory(key);
        if (!rec) return ok(`未找到记忆：${key}`);
        touchMemory(key);
        return ok(`${key} = ${rec.value}`);
      }
      case "list_memories": {
        const entries = listMemories();
        if (entries.length === 0) {
          return ok("（暂无记忆）", { entries: [] });
        }
        const lines = entries.map((e) => `• ${e.key} = ${e.value}`);
        return ok(`共 ${entries.length} 条记忆：\n` + lines.join("\n"), { entries });
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

        const queryEmbedding = await embedText(query);
        const records = getAllMemories({ types });
        const top = searchMemories({
          records,
          queryText: query.trim(),
          queryEmbedding,
          limit,
        });

        if (!top.length) {
          return ok(`未找到与「${query.trim()}」相关的记忆`, { entries: [] });
        }
        const lines = top.map(
          (e) => `• [${e.type}] ${e.key} = ${e.value} (score=${e.score})`
        );
        return ok(
          `命中 ${top.length} 条与「${query.trim()}」相关的记忆：\n` + lines.join("\n"),
          { entries: top }
        );
      }
      case "delete_memory": {
        const key = a.key;
        if (typeof key !== "string" || !key) return fail("缺少或无效的 key");
        deleteMemory(key);
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
await tryMigrateLegacy();
openDb();
await server.connect(transport);

// 清理钩子（stdio 通常由 relay kill，但能 close 则 close）
process.on("exit", closeDb);
process.on("SIGINT", () => {
  closeDb();
  process.exit(0);
});
process.on("SIGTERM", () => {
  closeDb();
  process.exit(0);
});
