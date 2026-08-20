/**
 * tool_calls 流式重组器（浏览器 / Node 通用，无 DOM 依赖，便于单测）。
 *
 * OpenAI 兼容接口在流式返回时，每个 delta 可能携带 `tool_calls` 数组，
 * 其中每一项形如：
 *   { index: 0, id: "call_abc", type: "function",
 *     function: { name: "fetch", arguments: "" } }
 * 同一个 index 的碎片会跨多个 delta 到来：首个含 id / type / function.name，
 * 后续碎片往往只携带 function.arguments 的 JSON 片段（name/id 为 null）。
 * 本模块按 index 聚合这些碎片，最终输出 assistant 消息体所需的完整 tool_calls。
 */

export class ToolCallAccumulator {
  constructor() {
    /** 每项：{ index, id, type, name, args } */
    this.calls = [];
  }

  /**
   * 消费一个 delta.tool_calls 数组（可空 / 可缺省）。
   * @param {Array|undefined} deltaToolCalls
   */
  add(deltaToolCalls) {
    if (!Array.isArray(deltaToolCalls)) return;
    for (const tc of deltaToolCalls) {
      const index = typeof tc.index === "number" ? tc.index : this.calls.length;
      let slot = this.calls.find((c) => c.index === index);
      if (!slot) {
        slot = { index, id: null, type: null, name: null, args: "" };
        this.calls.push(slot);
      }
      if (tc.id != null) slot.id = tc.id;
      if (tc.type != null) slot.type = tc.type;
      if (tc.function) {
        if (tc.function.name != null) slot.name = tc.function.name;
        if (typeof tc.function.arguments === "string") slot.args += tc.function.arguments;
      }
    }
  }

  /** 是否已有任何 tool_calls 累积 */
  get has() {
    return this.calls.length > 0;
  }

  /**
   * 输出 OpenAI assistant 消息体所需的 tool_calls 数组。
   * arguments 已拼接为完整 JSON 字符串（未解析，交由调用方按需 JSON.parse）。
   */
  toMessageToolCalls() {
    return this.calls
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((c) => ({
        id: c.id || `call_${c.index}`,
        type: c.type || "function",
        function: { name: c.name || "", arguments: c.args || "{}" },
      }));
  }

  /** 工具调用清单（用于 trace 展示：索引 / id / 名称 / 原始参数片段） */
  toTraceItems() {
    return this.calls
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((c) => ({
        index: c.index,
        id: c.id || `call_${c.index}`,
        name: c.name || "(未知)",
        argumentsRaw: c.args || "",
      }));
  }
}
