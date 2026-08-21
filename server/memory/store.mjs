import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// 项目根：由本文件位置推导（server/memory/store.mjs → 上两级）
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STORE_DIR = path.join(PROJECT_ROOT, "memory_db");
const STORE_PATH = path.join(STORE_DIR, "memory.db");
const LEGACY_JSON = path.join(STORE_DIR, "memory.json");
const LEGACY_JSON_BAK = path.join(STORE_DIR, "memory.json.legacy");

// 旧位置：~/.jarvis-mcp（早期版本存这里），仅用于一次性迁移检测
const OLD_STORE_DIR = path.join(os.homedir(), ".jarvis-mcp");

let dbSingleton = null;

export function getProjectRoot() {
  return PROJECT_ROOT;
}

export function getStoreDir() {
  return STORE_DIR;
}

export function getLegacyJsonPath() {
  return LEGACY_JSON;
}

export function getLegacyLegacyPath() {
  return LEGACY_JSON_BAK;
}

export function getDbPath() {
  return STORE_PATH;
}

export function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function serializeEmbedding(floats) {
  if (!floats || floats.length === 0) return null;
  const arr = new Float32Array(floats);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

export function deserializeEmbedding(buffer, dim) {
  if (!buffer || buffer.length === 0 || !dim) return null;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return new Float32Array(buf.buffer, buf.byteOffset, dim);
}

function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS memories (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'semantic',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER,
      importance REAL NOT NULL DEFAULT 0.5,
      scope TEXT NOT NULL DEFAULT 'global',
      embedding BLOB,
      embedding_dim INTEGER,
      embedding_source TEXT,
      embedding_failed INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_updated_at ON memories(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scope ON memories(scope);
    CREATE INDEX IF NOT EXISTS idx_failed ON memories(embedding_failed) WHERE embedding_failed = 1;
  `);
}

// 把旧位置（~/.jarvis-mcp）的数据一次性迁移到项目根 memory_db/。
// 仅在「新位置无任何数据」时执行，避免破坏已有数据。
// oldDir 仅测试注入用；正常运行走默认旧位置。
export function ensureStoreLocation({ oldDir = OLD_STORE_DIR } = {}) {
  if (fs.existsSync(STORE_PATH)) return; // 新位置已有 db，无需迁移

  const oldDb = path.join(oldDir, "memory.db");
  const oldJson = path.join(oldDir, "memory.json");
  const oldJsonBak = path.join(oldDir, "memory.json.legacy");
  const oldJsonBak2 = path.join(oldDir, "memory.json.bak");

  let moved = false;

  // 情况1：旧位置有 SQLite 数据库（含数据）
  if (fs.existsSync(oldDb)) {
    if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      const src = oldDb + suffix;
      const dst = STORE_PATH + suffix;
      if (fs.existsSync(src)) {
        try {
          fs.copyFileSync(src, dst);
        } catch (e) {
          throw new Error(`[store] 迁移旧数据库失败：${e.message}`);
        }
      }
    }
    moved = true;
  }

  // 情况2：旧位置只有 legacy/migrated JSON（从未成功建库）
  if (!moved) {
    for (const [src, dst] of [
      [oldJson, LEGACY_JSON],
      [oldJsonBak, LEGACY_JSON_BAK],
    ]) {
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
        try {
          fs.copyFileSync(src, dst);
        } catch (e) {
          throw new Error(`[store] 迁移旧 JSON 失败：${e.message}`);
        }
        moved = true;
      }
    }
  }

  // 预留：即使旧位置只有 memory.json.bak（旧版备份名），也一并迁
  if (!moved && fs.existsSync(oldJsonBak2) && !fs.existsSync(LEGACY_JSON_BAK)) {
    if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.copyFileSync(oldJsonBak2, LEGACY_JSON_BAK);
    moved = true;
  }
}

export function openDb() {
  if (dbSingleton) return dbSingleton;
  ensureStoreLocation();
  ensureDir();
  const db = new DatabaseSync(STORE_PATH);
  initSchema(db);
  dbSingleton = db;
  return db;
}

export function closeDb() {
  if (dbSingleton) {
    try {
      dbSingleton.close();
    } catch (_) {}
    dbSingleton = null;
  }
}

// 供测试用：完全重置内存数据库或重置文件数据库
export function resetDb({ memory = false, path: customPath } = {}) {
  closeDb();
  const target = customPath || (memory ? ":memory:" : STORE_PATH);
  if (!memory && fs.existsSync(target)) {
    try {
      fs.unlinkSync(target);
      const wal = target + "-wal";
      const shm = target + "-shm";
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch (e) {
      throw new Error(`[store] 重置数据库失败：${e.message}`);
    }
  }
  dbSingleton = new DatabaseSync(target);
  initSchema(dbSingleton);
  return dbSingleton;
}

export function isDbInitialized() {
  return fs.existsSync(STORE_PATH);
}

export function readLegacyJson() {
  if (!fs.existsSync(LEGACY_JSON)) return null;
  try {
    const txt = fs.readFileSync(LEGACY_JSON, "utf-8");
    if (!txt.trim()) return {};
    const obj = JSON.parse(txt);
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) {
    throw new Error(`[store] 读取 legacy JSON 失败：${e.message}`);
  }
}

// 把旧版扁平 { key: "字符串" } 或记录对象规范成统一结构
export function normalizeLegacyRecord(key, raw) {
  const t = Date.now();
  if (typeof raw === "string") {
    return {
      key,
      value: raw,
      type: "semantic",
      createdAt: t,
      updatedAt: t,
      accessCount: 0,
      importance: 0.5,
      scope: "global",
    };
  }
  const o = raw && typeof raw === "object" ? raw : {};
  return {
    key,
    value: typeof o.value === "string" ? o.value : String(o.value ?? ""),
    type: o.type || "semantic",
    createdAt: o.createdAt || t,
    updatedAt: o.updatedAt || t,
    accessCount: o.accessCount || 0,
    importance: typeof o.importance === "number" ? o.importance : 0.5,
    scope: o.scope || "global",
  };
}

export function upsertMemory({
  key,
  value,
  type = "semantic",
  importance = 0.5,
  scope = "global",
  embedding = null,
  embeddingSource = null,
  embeddingFailed = 0,
  createdAt,
  updatedAt,
  accessCount,
}) {
  const db = openDb();
  const t = Date.now();
  const embBuf = serializeEmbedding(embedding);
  const dim = embedding ? embedding.length : null;

  const stmt = db.prepare(`
    INSERT INTO memories (key, value, type, created_at, updated_at, access_count, last_accessed_at,
                          importance, scope, embedding, embedding_dim, embedding_source, embedding_failed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      type = excluded.type,
      updated_at = excluded.updated_at,
      importance = excluded.importance,
      scope = excluded.scope,
      embedding = excluded.embedding,
      embedding_dim = excluded.embedding_dim,
      embedding_source = excluded.embedding_source,
      embedding_failed = excluded.embedding_failed
  `);
  stmt.run(
    key,
    value,
    type,
    createdAt ?? t,
    updatedAt ?? t,
    accessCount ?? 0,
    null,
    importance,
    scope,
    embBuf,
    dim,
    embeddingSource,
    embeddingFailed ? 1 : 0
  );
}

export function getMemory(key) {
  const db = openDb();
  const stmt = db.prepare("SELECT * FROM memories WHERE key = ?");
  const row = stmt.get(key);
  if (row) {
    row.embedding = deserializeEmbedding(row.embedding, row.embedding_dim);
  }
  return row || null;
}

export function touchMemory(key) {
  const db = openDb();
  const stmt = db.prepare(`
    UPDATE memories
    SET access_count = access_count + 1,
        last_accessed_at = ?,
        updated_at = ?
    WHERE key = ?
  `);
  const t = Date.now();
  stmt.run(t, t, key);
}

export function listMemories() {
  const db = openDb();
  const stmt = db.prepare("SELECT key, value FROM memories ORDER BY updated_at DESC");
  return stmt.all();
}

export function deleteMemory(key) {
  const db = openDb();
  const stmt = db.prepare("DELETE FROM memories WHERE key = ?");
  stmt.run(key);
}

// 返回所有带 embedding 的记录，用于向量检索
export function getAllMemories({ types = null, scope = null } = {}) {
  const db = openDb();
  let sql = "SELECT * FROM memories";
  const conditions = [];
  const params = [];
  if (types && types.length > 0) {
    conditions.push(`type IN (${types.map(() => "?").join(", ")})`);
    params.push(...types);
  }
  if (scope) {
    conditions.push("scope = ?");
    params.push(scope);
  }
  if (conditions.length) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);
  for (const row of rows) {
    row.embedding = deserializeEmbedding(row.embedding, row.embedding_dim);
  }
  return rows;
}

export function bulkInsert(records) {
  const db = openDb();
  const insert = db.prepare(`
    INSERT INTO memories (key, value, type, created_at, updated_at, access_count, last_accessed_at,
                          importance, scope, embedding, embedding_dim, embedding_source, embedding_failed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const t = Date.now();
  try {
    db.exec("BEGIN TRANSACTION");
    for (const rec of records) {
      const embBuf = serializeEmbedding(rec.embedding);
      const dim = rec.embedding ? rec.embedding.length : null;
      insert.run(
        rec.key,
        rec.value,
        rec.type || "semantic",
        rec.createdAt || t,
        rec.updatedAt || t,
        rec.accessCount || 0,
        rec.lastAccessedAt || null,
        typeof rec.importance === "number" ? rec.importance : 0.5,
        rec.scope || "global",
        embBuf,
        dim,
        rec.embeddingSource || null,
        rec.embeddingFailed ? 1 : 0
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch (_) {}
    throw e;
  }
}

export function legacyJsonExists() {
  return fs.existsSync(LEGACY_JSON);
}

export function markLegacyMigrated() {
  if (fs.existsSync(LEGACY_JSON)) {
    fs.renameSync(LEGACY_JSON, LEGACY_JSON_BAK);
  }
}

export function restoreLegacyFromMigration() {
  if (fs.existsSync(LEGACY_JSON_BAK) && !fs.existsSync(LEGACY_JSON)) {
    fs.renameSync(LEGACY_JSON_BAK, LEGACY_JSON);
  }
}
