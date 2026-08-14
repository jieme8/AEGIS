/**
 * 纯 SSE（Server-Sent Events）行解析器。
 * 浏览器与 Node 通用，无 DOM / fetch 依赖，便于单元测试。
 *
 * OpenAI 兼容流式接口按行返回形如：
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 *   （空行分隔事件）
 *   data: [DONE]
 * 本函数逐块消费解码后的文本，按 `\n` 切分，提取以 `data:` 开头的负载，
 * 忽略注释行（以 `:` 开头）、`event:`/`id:` 等其它字段，遇 `[DONE]` 标记结束。
 */

/**
 * 解析一段 SSE 文本块。
 * @param {string} buffer 本次新增的解码文本（可能不含结尾换行）。
 * @param {string} [carry=""] 上一次调用遗留的未完成行（无结尾换行）。
 * @returns {{events: string[], done: boolean, carry: string}}
 *   events: 本次解析出的 data 负载字符串数组（已去除 "data:" 前缀与首空格，不含 [DONE]）。
 *   done:   是否遇到 data:[DONE]。
 *   carry:  本次未完成、需拼接下一次 buffer 的剩余文本。
 */
export function parseSSEChunk(buffer, carry = "") {
  const text = carry + (buffer == null ? "" : String(buffer));
  const parts = text.split("\n");
  // 最后一个片段没有以 \n 结尾，视为未完成行，留作下次 carry
  const incomplete = parts.pop() || "";

  const events = [];
  let done = false;

  for (const raw of parts) {
    let line = raw;
    if (line.endsWith("\r")) line = line.slice(0, -1); // 兼容 \r\n
    if (line.length === 0) continue;                   // 事件间的空行
    if (line.startsWith(":")) continue;                // SSE 注释行
    if (!line.startsWith("data:")) continue;           // 仅处理 data 字段

    // "data:" 后可选一个空格（SSE 规范：data: X -> 值为 "X"）
    let payload = line.slice(5);
    if (payload.startsWith(" ")) payload = payload.slice(1);

    if (payload === "[DONE]") {
      done = true;
    } else {
      events.push(payload);
    }
  }

  return { events, done, carry: incomplete };
}
