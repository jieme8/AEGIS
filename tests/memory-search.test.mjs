import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  searchMemories,
  cosine,
  keywordScore,
  ngrams,
  unigrams,
} from "../server/memory/search.mjs";

describe("search", () => {
  it("cosine 相同向量 = 1，正交向量 ≈ 0", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    const c = new Float32Array([0, 1, 0]);
    assert.equal(cosine(a, b), 1);
    assert.equal(cosine(a, c), 0);
  });

  it("ngrams 拆分中文 bigram 与拉丁词", () => {
    const g = ngrams("Hello 用户语言 world");
    assert.ok(g.includes("hello"));
    assert.ok(g.includes("world"));
    assert.ok(g.includes("用户"));
    assert.ok(g.includes("户语"));
    assert.ok(g.includes("语言"));
  });

  it("unigrams 拆单字/单词", () => {
    const u = unigrams("我住哪里");
    assert.deepEqual(u.sort(), ["我", "住", "哪", "里"].sort());
  });

  it("keywordScore 命中 key 权重高于 value", () => {
    const key = "user_language";
    const value = "用户偏好语言";
    const score1 = keywordScore("language", key, value);
    const score2 = keywordScore("用户", key, value);
    assert.ok(score1 > 0);
    assert.ok(score2 > 0);
    assert.ok(score1 >= score2); // 拉丁词命中 key 得分更高
  });

  it("searchMemories 按向量 + 关键词混合排序", () => {
    const queryText = "用户语言";
    const queryVec = new Float32Array([1, 0, 0, 0]);

    const records = [
      {
        key: "user_lang",
        value: "用户偏好语言",
        type: "semantic",
        updated_at: Date.now(),
        access_count: 0,
        importance: 0.5,
        embedding: new Float32Array([1, 0, 0, 0]),
        embedding_dim: 4,
      },
      {
        key: "theme",
        value: "暗色主题",
        type: "semantic",
        updated_at: Date.now() - 86400000,
        access_count: 10,
        importance: 0.5,
        embedding: new Float32Array([0, 1, 0, 0]),
        embedding_dim: 4,
      },
      {
        key: "old_lang",
        value: "语言设置 old",
        type: "semantic",
        updated_at: Date.now() - 30 * 86400000,
        access_count: 0,
        importance: 0.5,
        embedding: new Float32Array([0.9, 0.1, 0, 0]),
        embedding_dim: 4,
      },
    ];

    const top = searchMemories({ records, queryText, queryEmbedding: queryVec, limit: 3 });
    assert.equal(top.length, 2);
    assert.equal(top[0].key, "user_lang"); // 向量完全匹配 + 关键词命中
    assert.equal(top[1].key, "old_lang");
    assert.ok(top[0].score > top[1].score);
  });

  it("searchMemories 无匹配返回空", () => {
    const records = [
      {
        key: "a",
        value: " unrelated ",
        type: "semantic",
        updated_at: Date.now(),
        access_count: 0,
        importance: 0.5,
        embedding: new Float32Array([0, 1]),
        embedding_dim: 2,
      },
    ];
    const result = searchMemories({
      records,
      queryText: "完全不相关",
      queryEmbedding: new Float32Array([1, 0]),
      limit: 5,
    });
    assert.equal(result.length, 0);
  });

  it("空查询返回空", () => {
    const result = searchMemories({
      records: [{ key: "a", value: "v" }],
      queryText: "   ",
      queryEmbedding: new Float32Array([1]),
    });
    assert.equal(result.length, 0);
  });
});
