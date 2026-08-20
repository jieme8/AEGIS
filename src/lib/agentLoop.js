/**
 * Agent tool-loop 编排（纯函数：无 DOM / fetch / SDK 依赖，便于 Node 单测）。
 *
 * 流程：把消息交给 LLM（携带 tools）。若 LLM 返回 tool_calls，则逐个执行工具、
 * 把结果作为 role:"tool" 消息回填，再请求 LLM，直到 LLM 不再返回 tool_calls 或
 * 达到最大迭代次数（防失控）。最终返回完整消息历史与最终回复文本。
 *
 * 调用方（useChatController）负责提供「真实流式请求 LLM」与「执行 MCP 工具」的实现，
 * 本函数只关心编排逻辑与消息结构。
 */

export const DEFAULT_MAX_ITERATIONS = 5;

/**
 * @param {object} opts
 * @param {Array}  opts.messages        初始消息（OpenAI 格式：system + 历史 + 当前 user）
 * @param {() => Promise<Array>} opts.getTools   返回可用 tools（OpenAI function 格式）；失败应返回 []。
 * @param {(messages: Array, tools: Array) => Promise<{toolCalls?: Array, content?: string, reasoning?: string, error?: string}>} opts.requestLLM
 *        请求一次 LLM（已流式合并）。toolCalls 为空表示最终回答。error 表示本次请求失败。
 * @param {(name: string, args: object, callId: string) => Promise<{content: string, isError?: boolean}>} opts.executeTool
 *        执行单个工具，返回 { content, isError }。
 * @param {number} [opts.maxIterations]
 * @param {(ev: object) => void} [opts.onEvent]  每轮事件回调（用于 trace 可视化）。
 * @returns {Promise<{messages: Array, finalContent: string, finalReasoning: string, iterations: number, toolInvocations: Array, degraded: boolean}>}
 */
export async function runAgentLoop(opts) {
  const { messages, getTools, requestLLM, executeTool } = opts;
  const maxIterations = opts.maxIterations || DEFAULT_MAX_ITERATIONS;
  const onEvent = opts.onEvent || (() => {});

  const working = messages.map((m) => ({ ...m }));
  let tools = [];
  let degraded = false;

  try {
    tools = (await getTools()) || [];
  } catch (e) {
    tools = [];
    degraded = true;
  }
  if (tools.length === 0) degraded = true;

  const toolInvocations = [];
  let finalContent = "";
  let finalReasoning = "";
  let iterations = 0;
  let llmFailed = false;
  let llmError = "";

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;
    const res = await requestLLM(working, tools);

    if (res.error) {
      // LLM 调用失败：标记降级，停止循环（调用方据此回退本地模拟 / 无工具对话）
      degraded = true;
      llmFailed = true;
      llmError = res.error;
      finalContent = res.content || "";
      finalReasoning = res.reasoning || "";
      onEvent({ type: "error", error: res.error });
      break;
    }

    finalContent = res.content || "";
    finalReasoning = res.reasoning || "";
    const toolCalls = res.toolCalls || [];

    // —— 无 tool_calls：本轮即为最终回答 ——
    if (toolCalls.length === 0) {
      onEvent({ type: "final", content: finalContent, reasoning: finalReasoning });
      break;
    }

    // —— 有 tool_calls：追加 assistant 消息（含 tool_calls），再逐个执行工具 ——
    const assistantMsg = {
      role: "assistant",
      content: res.content || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: tc.type || "function",
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    };
    working.push(assistantMsg);
    onEvent({ type: "assistant_toolcalls", toolCalls });

    for (const tc of toolCalls) {
      const callId = tc.id;
      const name = (tc.function && tc.function.name) || "(unknown)";
      let args = {};
      try {
        args = tc.function && tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch (e) {
        args = { __parseError: tc.function && tc.function.arguments };
      }

      let toolResult = "";
      let isError = false;
      try {
        const r = await executeTool(name, args, callId);
        toolResult = r.content;
        isError = !!r.isError;
      } catch (e) {
        isError = true;
        toolResult = "工具执行失败：" + (e && e.message ? e.message : String(e));
      }

      const invocation = { callId, name, args, result: toolResult, isError };
      toolInvocations.push(invocation);
      onEvent({ type: "tool", invocation });

      working.push({ role: "tool", tool_call_id: callId, content: toolResult });
    }
    // 带上工具结果，进入下一轮请求
  }

  return {
    messages: working,
    finalContent,
    finalReasoning,
    iterations,
    toolInvocations,
    degraded,
    llmFailed,
    llmError,
  };
}
