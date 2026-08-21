import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  resetDb,
  closeDb,
  normalizeLegacyRecord,
  bulkInsert,
  getMemory,
  listMemories,
} from "../server/memory/store.mjs";

const tmpDir = path.join(os.tmpdir(), "aegis-memory-migrate-test-" + Date.now());
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

describe("migrate", () => {
  it("把旧 JSON 记录迁移到 SQLite（模拟批量 embedding）", () => {
    resetDb({ path: tmpDb });

    const legacy = {
      user_name: "张三",
      project: {
        value: "AEGIS 音频可视化",
        type: "semantic",
        importance: 0.9,
        scope: "aegis",
      },
      old_flat: "旧版字符串值",
    };

    const records = Object.keys(legacy).map((k) =>
      normalizeLegacyRecord(k, legacy[k])
    );

    // 模拟 embedding 后批量插入
    const withEmbeddings = records.map((r, i) => ({
      ...r,
      embedding: new Float32Array([i / 10, 1 - i / 10]),
      embeddingSource: "longcat",
    }));

    bulkInsert(withEmbeddings);

    assert.equal(listMemories().length, 3);

    const user = getMemory("user_name");
    assert.equal(user.value, "张三");
    assert.equal(user.type, "semantic");

    const proj = getMemory("project");
    assert.equal(proj.value, "AEGIS 音频可视化");
    assert.equal(proj.importance, 0.9);
    assert.equal(proj.scope, "aegis");

    const old = getMemory("old_flat");
    assert.equal(old.value, "旧版字符串值");
    assert.equal(old.embedding_dim, 2);
    assert.deepEqual(old.embedding, new Float32Array([0.2, 0.8]));
  });
});
