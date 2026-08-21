import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  resetDb,
  closeDb,
  upsertMemory,
  getMemory,
  touchMemory,
  listMemories,
  deleteMemory,
  getAllMemories,
  bulkInsert,
  normalizeLegacyRecord,
  deserializeEmbedding,
} from "../server/memory/store.mjs";

const tmpDir = path.join(os.tmpdir(), "aegis-memory-test-" + Date.now());
const tmpDb = path.join(tmpDir, "memory.db");

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  closeDb();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});

describe("store", () => {
  it("upsert + get + list + delete", () => {
    resetDb({ path: tmpDb });
    upsertMemory({ key: "foo", value: "bar", type: "semantic", importance: 0.8 });

    const rec = getMemory("foo");
    assert.equal(rec.key, "foo");
    assert.equal(rec.value, "bar");
    assert.equal(rec.type, "semantic");
    assert.equal(rec.importance, 0.8);
    assert.ok(rec.created_at > 0);

    const all = listMemories();
    assert.equal(all.length, 1);
    assert.equal(all[0].key, "foo");

    deleteMemory("foo");
    assert.equal(getMemory("foo"), null);
  });

  it("upsert 覆盖并保留 created_at", () => {
    resetDb({ path: tmpDb });
    upsertMemory({ key: "k", value: "v1" });
    const first = getMemory("k");

    // 时间推进
    const later = Date.now() + 1000;
    upsertMemory({ key: "k", value: "v2", createdAt: later, updatedAt: later });
    const second = getMemory("k");

    assert.equal(second.value, "v2");
    assert.equal(second.created_at, first.created_at); // created_at 不变
    assert.ok(second.updated_at >= first.updated_at);
  });

  it("embedding 序列化与反序列化", () => {
    resetDb({ path: tmpDb });
    const vec = new Float32Array([0.1, 0.2, 0.3, -0.4]);
    upsertMemory({ key: "v", value: "vec", embedding: vec, embeddingSource: "mock" });

    const rec = getMemory("v");
    assert.equal(rec.embedding_dim, 4);
    assert.deepEqual(rec.embedding, vec);
    assert.equal(rec.embedding_source, "mock");
  });

  it("touch 更新 access_count 与 last_accessed_at", () => {
    resetDb({ path: tmpDb });
    upsertMemory({ key: "k", value: "v" });
    touchMemory("k");
    const rec = getMemory("k");
    assert.equal(rec.access_count, 1);
    assert.ok(rec.last_accessed_at > 0);
  });

  it("getAllMemories 按类型过滤", () => {
    resetDb({ path: tmpDb });
    upsertMemory({ key: "a", value: "va", type: "semantic" });
    upsertMemory({ key: "b", value: "vb", type: "episodic" });
    upsertMemory({ key: "c", value: "vc", type: "procedural" });

    const sem = getAllMemories({ types: ["semantic"] });
    assert.equal(sem.length, 1);
    assert.equal(sem[0].key, "a");

    const two = getAllMemories({ types: ["semantic", "procedural"] });
    assert.equal(two.length, 2);
  });

  it("bulkInsert 批量写入", () => {
    resetDb({ path: tmpDb });
    bulkInsert([
      { key: "x", value: "vx", embedding: new Float32Array([1, 0]) },
      { key: "y", value: "vy", embedding: new Float32Array([0, 1]) },
    ]);
    assert.equal(listMemories().length, 2);
    assert.equal(getMemory("x").embedding_dim, 2);
  });

  it("normalizeLegacyRecord 兼容字符串和对象", () => {
    const t0 = Date.now();
    const r1 = normalizeLegacyRecord("k1", "hello");
    assert.equal(r1.value, "hello");
    assert.equal(r1.type, "semantic");
    assert.ok(r1.createdAt >= t0);

    const r2 = normalizeLegacyRecord("k2", {
      value: "world",
      type: "episodic",
      importance: 0.9,
      accessCount: 3,
      scope: "aegis",
    });
    assert.equal(r2.value, "world");
    assert.equal(r2.type, "episodic");
    assert.equal(r2.importance, 0.9);
    assert.equal(r2.accessCount, 3);
    assert.equal(r2.scope, "aegis");
  });

  it("deserializeEmbedding 对空值安全", () => {
    assert.equal(deserializeEmbedding(null, 4), null);
    assert.equal(deserializeEmbedding(Buffer.alloc(0), 4), null);
    assert.equal(deserializeEmbedding(Buffer.alloc(8), 0), null);
  });
});
