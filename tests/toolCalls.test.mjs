import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolCallAccumulator } from "../src/lib/toolCalls.js";

// 模拟 OpenAI 流式接口对 tool_calls 的逐 delta 切片：
// 首片带 id/type/function.name，argument 为空；后续仅追加 arguments 碎片。
test("流式碎片按 index 重组为完整 tool_calls", () => {
  const acc = new ToolCallAccumulator();
  acc.add([{ index: 0, id: "call_1", type: "function", function: { name: "fetch", arguments: "" } }]);
  acc.add([{ index: 0, function: { arguments: '{"url":' } }]);
  acc.add([{ index: 0, function: { arguments: '"https://example.com"}' } }]);

  assert.equal(acc.has, true);
  const out = acc.toMessageToolCalls();
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "call_1");
  assert.equal(out[0].function.name, "fetch");
  assert.equal(out[0].function.arguments, '{"url":"https://example.com"}');
});

test("多个并行 tool_calls 各自独立重组", () => {
  const acc = new ToolCallAccumulator();
  acc.add([
    { index: 0, id: "call_a", type: "function", function: { name: "a", arguments: "{}" } },
    { index: 1, id: "call_b", type: "function", function: { name: "b", arguments: '{"x":1}' } },
  ]);
  const out = acc.toMessageToolCalls();
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((t) => t.function.name), ["a", "b"]);
  assert.equal(out[1].function.arguments, '{"x":1}');
});

test("arguments 跨多片追加且未解析", () => {
  const acc = new ToolCallAccumulator();
  acc.add([{ index: 0, id: "c", type: "function", function: { name: "f", arguments: '{"a":' } }]);
  acc.add([{ index: 0, function: { arguments: '1}' } }]);
  const args = acc.toMessageToolCalls()[0].function.arguments;
  assert.equal(args, '{"a":1}');
  // 重组层不负责解析，调用方按需 JSON.parse
  assert.doesNotThrow(() => JSON.parse(args));
});

test("toTraceItems 暴露索引/id/名称/原始参数", () => {
  const acc = new ToolCallAccumulator();
  acc.add([{ index: 0, id: "call_x", type: "function", function: { name: "fetch", arguments: '{"url":"u"}' } }]);
  const items = acc.toTraceItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "call_x");
  assert.equal(items[0].name, "fetch");
  assert.equal(items[0].argumentsRaw, '{"url":"u"}');
});

test("空 delta 不报错、has 为 false", () => {
  const acc = new ToolCallAccumulator();
  acc.add(undefined);
  acc.add([]);
  assert.equal(acc.has, false);
  assert.deepEqual(acc.toMessageToolCalls(), []);
});
