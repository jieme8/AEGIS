import { test } from "node:test";
import assert from "node:assert/strict";
import { MCPClient } from "../src/lib/mcpClient.js";
import { runAgentLoop, DEFAULT_MAX_ITERATIONS } from "../src/lib/agentLoop.js";

// ---------- 工具：构造 mock fetch（返回类 Response 对象，无需真实网络） ----------
function mockFetch(handler) {
  return async (url, init) => {
    const { method, body } = init || {};
    const data = handler(url, method, body ? JSON.parse(body) : undefined);
    return {
      ok: data.__status !== undefined ? data.__status < 400 : true,
      status: data.__status || 200,
      json: async () => {
        const { __status, ...rest } = data;
        return rest;
      },
    };
  };
}

// ================= MCPClient 测试 =================
test("MCPClient.listTools 返回扁平工具列表", async () => {
  const fetchFn = mockFetch((url, method) => {
    assert.equal(method, "GET");
    assert.ok(url.endsWith("/list"));
    return { tools: [{ name: "fetch", server: "fetch", description: "抓取", inputSchema: {} }] };
  });
  const client = new MCPClient("/api/mcp", { fetchFn });
  const tools = await client.listTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "fetch");
});

test("MCPClient.toOpenAITools 转换为 function 声明", () => {
  const tools = [{ name: "fetch", description: "抓取网页", inputSchema: { type: "object" } }];
  const out = MCPClient.toOpenAITools(tools);
  assert.equal(out[0].type, "function");
  assert.equal(out[0].function.name, "fetch");
  assert.equal(out[0].function.parameters.type, "object");
});

test("MCPClient.getStatus 返回 per-server 状态与汇总", async () => {
  const fetchFn = mockFetch((url, method) => {
    assert.equal(method, "GET");
    assert.ok(url.endsWith("/status"));
    return {
      ok: true,
      generatedAt: "2026-08-14T05:11:15.422Z",
      servers: [
        { name: "fetch", enabled: true, transport: "stdio", status: "connected", toolCount: 1, tools: ["fetch"], error: null, latencyMs: 487 },
        { name: "memory", enabled: false, transport: "stdio", status: "disabled", toolCount: 0, tools: [], error: null, latencyMs: null },
      ],
      summary: { total: 2, connected: 1, disabled: 1, error: 0, usable: 1 },
    };
  });
  const client = new MCPClient("/api/mcp", { fetchFn });
  const d = await client.getStatus();
  assert.equal(d.ok, true);
  assert.equal(d.servers.length, 2);
  assert.equal(d.servers[0].status, "connected");
  assert.equal(d.servers[1].status, "disabled");
  assert.equal(d.summary.usable, 1);
  assert.equal(d.summary.total, 2);
});

test("MCPClient.callTool 发起 POST 并返回 content", async () => {
  const fetchFn = mockFetch((url, method, body) => {
    assert.equal(method, "POST");
    assert.ok(url.endsWith("/call"));
    assert.equal(body.name, "fetch");
    assert.equal(body.arguments.url, "https://example.com");
    return { content: "<html>ok</html>", isError: false };
  });
  const client = new MCPClient("/api/mcp", { fetchFn });
  const r = await client.callTool("fetch", { url: "https://example.com" });
  assert.equal(r.content, "<html>ok</html>");
  assert.equal(r.isError, false);
});

test("MCPClient 非 2xx 抛出带错误信息的异常", async () => {
  const fetchFn = mockFetch(() => ({ __status: 500, error: "relay 内部错误" }));
  const client = new MCPClient("/api/mcp", { fetchFn });
  await assert.rejects(() => client.listTools(), /relay 内部错误/);
});

test("MCPClient 超时抛超时异常", async () => {
  const fetchFn = () =>
    new Promise((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 5);
    });
  const client = new MCPClient("/api/mcp", { fetchFn, timeoutMs: 2 });
  await assert.rejects(() => client.listTools(), /超时/);
});

// ================= agentLoop 测试 =================
test("tool-loop：首轮返回 tool_calls，次轮返回最终答案", async () => {
  const calls = [];
  const requestLLM = async (messages, tools) => {
    calls.push(tools.length);
    if (calls.length === 1) {
      return {
        content: null,
        toolCalls: [{ id: "call_1", type: "function", function: { name: "fetch", arguments: '{"url":"u"}' } }],
      };
    }
    return { content: "根据联网结果：答案是 42。", toolCalls: [] };
  };
  const executeTool = async (name, args, callId) => {
    assert.equal(name, "fetch");
    assert.equal(callId, "call_1");
    return { content: "42", isError: false };
  };

  const result = await runAgentLoop({
    messages: [{ role: "user", content: "查一下答案" }],
    getTools: async () => [{ type: "function", function: { name: "fetch" } }],
    requestLLM,
    executeTool,
  });

  assert.equal(result.finalContent, "根据联网结果：答案是 42。");
  assert.equal(result.iterations, 2);
  assert.equal(result.toolInvocations.length, 1);
  assert.equal(result.toolInvocations[0].result, "42");
  // 工作历史应含：user → assistant(tool_calls) → tool →（次轮无新持久消息）
  const roles = result.messages.map((m) => m.role);
  assert.deepEqual(roles, ["user", "assistant", "tool"]);
  assert.equal(result.messages[1].tool_calls[0].function.name, "fetch");
  assert.equal(result.messages[2].tool_call_id, "call_1");
});

test("tool-loop：工具执行失败不崩溃，结果回填并继续", async () => {
  let n = 0;
  const requestLLM = async () => {
    n += 1;
    if (n === 1) return { content: null, toolCalls: [{ id: "c", type: "function", function: { name: "bad", arguments: "{}" } }] };
    return { content: "已处理工具失败。", toolCalls: [] };
  };
  const executeTool = async () => { throw new Error("boom"); };

  const result = await runAgentLoop({
    messages: [{ role: "user", content: "hi" }],
    getTools: async () => [{ type: "function", function: { name: "bad" } }],
    requestLLM,
    executeTool,
  });
  assert.equal(result.finalContent, "已处理工具失败。");
  assert.equal(result.toolInvocations[0].isError, true);
  assert.match(result.toolInvocations[0].result, /boom/);
});

test("tool-loop：达到最大迭代次数后停止（防失控）", async () => {
  const requestLLM = async () => ({
    content: null,
    toolCalls: [{ id: "c", type: "function", function: { name: "loop", arguments: "{}" } }],
  });
  const executeTool = async () => ({ content: "x", isError: false });
  const onEvent = () => {};

  const result = await runAgentLoop({
    messages: [{ role: "user", content: "loop me" }],
    getTools: async () => [{ type: "function", function: { name: "loop" } }],
    requestLLM,
    executeTool,
    onEvent,
  });
  assert.equal(result.iterations, DEFAULT_MAX_ITERATIONS);
  assert.equal(result.toolInvocations.length, DEFAULT_MAX_ITERATIONS);
});

test("降级：getTools 抛错时仍能返回最终答案", async () => {
  const requestLLM = async (messages, tools) => {
    assert.equal(tools.length, 0); // 降级时不带工具
    return { content: "无工具也能回答。", toolCalls: [] };
  };
  const result = await runAgentLoop({
    messages: [{ role: "user", content: "hi" }],
    getTools: async () => { throw new Error("relay 不可用"); },
    requestLLM,
    executeTool: async () => ({ content: "", isError: false }),
  });
  assert.equal(result.degraded, true);
  assert.equal(result.finalContent, "无工具也能回答。");
  assert.equal(result.toolInvocations.length, 0);
});

test("LLM 首轮即失败：标记 degraded 并停止", async () => {
  const requestLLM = async () => ({ content: "", error: "timeout" });
  const result = await runAgentLoop({
    messages: [{ role: "user", content: "hi" }],
    getTools: async () => [],
    requestLLM,
    executeTool: async () => ({ content: "", isError: false }),
  });
  assert.equal(result.degraded, true);
  assert.equal(result.iterations, 1);
});
