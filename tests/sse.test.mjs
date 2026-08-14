import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSSEChunk } from "../src/lib/sse.js";

test("单行 data 事件被解析", () => {
  const r = parseSSEChunk('data: {"a":1}\n');
  assert.deepEqual(r.events, ['{"a":1}']);
  assert.equal(r.done, false);
  assert.equal(r.carry, "");
});

test("多行 + 空行分隔的事件全部解析", () => {
  const chunk =
    'data: {"choices":[{"delta":{"content":"你"}}]}\n' +
    "\n" +
    'data: {"choices":[{"delta":{"content":"好"}}]}\n';
  const r = parseSSEChunk(chunk);
  assert.deepEqual(r.events, [
    '{"choices":[{"delta":{"content":"你"}}]}',
    '{"choices":[{"delta":{"content":"好"}}]}',
  ]);
  assert.equal(r.done, false);
});

test("data:[DONE] 标记 done 且不进入 events", () => {
  const r = parseSSEChunk("data: [DONE]\n");
  assert.equal(r.done, true);
  assert.deepEqual(r.events, []);
});

test("跨块截断的 data 行被正确拼接", () => {
  const first = parseSSEChunk('data: {"choices":[{"delta');
  assert.equal(first.events.length, 0);
  assert.equal(first.carry, 'data: {"choices":[{"delta');

  const second = parseSSEChunk('":{"content":"Hi"}}]}\n', first.carry);
  assert.deepEqual(second.events, ['{"choices":[{"delta":{"content":"Hi"}}]}']);
  assert.equal(second.carry, "");
});

test("跳过注释行与 data: 前缀外的其它字段", () => {
  const chunk =
    ": keep-alive\n" +
    "event: message\n" +
    'data: {"x":1}\n' +
    "id: 9\n";
  const r = parseSSEChunk(chunk);
  assert.deepEqual(r.events, ['{"x":1}']);
});

test("兼容 \\r\\n 行尾", () => {
  const r = parseSSEChunk('data: {"ok":true}\r\n');
  assert.deepEqual(r.events, ['{"ok":true}']);
  assert.equal(r.carry, "");
});

test("心跳/空白内容不产生事件，carry 为空字符串", () => {
  const r = parseSSEChunk("\n\n");
  assert.deepEqual(r.events, []);
  assert.equal(r.done, false);
  assert.equal(r.carry, "");
});

test("带 tool_calls 的 delta 原样透传（重组由 ToolCallAccumulator 处理）", () => {
  const delta =
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"fetch","arguments":""}}]}}]}\n';
  const r = parseSSEChunk(delta);
  assert.equal(r.events.length, 1);
  const json = JSON.parse(r.events[0]);
  const tc = json.choices[0].delta.tool_calls[0];
  assert.equal(tc.function.name, "fetch");
  assert.equal(tc.id, "call_1");
});

test("连续多次调用累计多个事件与 done", () => {
  let carry = "";
  let done = false;
  let evs = [];
  ({ carry, done } = parseSSEChunk('data: {"p":1}\n', carry));
  ({ events: evs, carry, done } = parseSSEChunk('data: {"p":2}\n', carry));
  assert.deepEqual(evs, ['{"p":2}']); // 仅返回本次新增
  ({ events: evs, carry, done } = parseSSEChunk("data: [DONE]\n", carry));
  assert.equal(done, true);
});
