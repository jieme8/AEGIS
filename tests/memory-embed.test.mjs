import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  embedText,
  embedBatch,
  embedRecords,
  getModel,
  getEmbedUrl,
} from "../server/memory/embed.mjs";

const originalFetch = globalThis.fetch;

// 模拟 Ollama /api/embed：{ model, embeddings }
function makeMockFetch(vectors) {
  return async (url, options) => {
    // 校验请求体
    const body = JSON.parse(options.body);
    assert.ok(body.model, "请求应带 model");
    assert.ok(Array.isArray(body.input), "请求应带 input 数组");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        embeddings: vectors.map((v) => Array.from(Float32Array.from(v))),
      }),
    };
  };
}

before(() => {
  delete process.env.OLLAMA_URL;
  delete process.env.OLLAMA_EMBED_MODEL;
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe("embed (Ollama)", () => {
  it("默认模型 / URL 正确", () => {
    assert.equal(
      getModel(),
      "quentinz/bge-small-zh-v1.5:latest"
    );
    assert.equal(getEmbedUrl(), "http://localhost:11434/api/embed");
  });

  it("embedText 返回 Float32Array", async () => {
    globalThis.fetch = makeMockFetch([new Float32Array([0.1, 0.2, 0.3])]);
    const vec = await embedText("hello");
    assert.ok(vec instanceof Float32Array);
    assert.equal(vec.length, 3);
    assert.ok(Math.abs(vec[0] - 0.1) < 1e-6);
  });

  it("embedBatch 返回与输入等长的向量数组", async () => {
    globalThis.fetch = makeMockFetch([
      new Float32Array([1, 0]),
      new Float32Array([0, 1]),
    ]);
    const out = await embedBatch(["a", "b"]);
    assert.equal(out.length, 2);
    assert.equal(out[0][0], 1);
    assert.equal(out[1][1], 1);
  });

  it("embedRecords 给记录附加 embedding 与 source", async () => {
    globalThis.fetch = makeMockFetch([
      new Float32Array([0.1, 0.2]),
      new Float32Array([0.3, 0.4]),
    ]);
    const records = [{ key: "a", value: "va" }, { key: "b", value: "vb" }];
    const out = await embedRecords(records);
    assert.equal(out.length, 2);
    assert.equal(out[0].embeddingSource, "ollama");
    assert.equal(out[0].embedding.length, 2);
  });

  it("自定义 OLLAMA_URL / OLLAMA_EMBED_MODEL 生效", () => {
    process.env.OLLAMA_URL = "http://127.0.0.1:11434/";
    process.env.OLLAMA_EMBED_MODEL = "quentinz/bge-large-zh-v1.5:latest";
    assert.equal(
      getEmbedUrl().replace(/\/+$/, ""),
      "http://127.0.0.1:11434/api/embed"
    );
    assert.equal(getModel(), "quentinz/bge-large-zh-v1.5:latest");
    delete process.env.OLLAMA_URL;
    delete process.env.OLLAMA_EMBED_MODEL;
  });

  it("接口非 200 时抛错", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "kaboom",
    });
    await assert.rejects(() => embedText("x"), /500/);
  });

  it("Ollama 返回错误字段时抛错", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: "model 'x' not found" }),
    });
    await assert.rejects(() => embedText("x"), /model 'x' not found/);
  });
});