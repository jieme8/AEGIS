/**
 * 主动记忆召回（Proactive Recall）。
 *
 * 与 autoMemory（写入侧）配对：在每轮对话构造 prompt 时，先用用户本轮问题检索
 * 长期记忆（search_memory 工具），把命中的 top-K 事实拼成 <memory> 段注入 system
 * 提示词，使助手“自带上下文”回答，而不依赖 LLM 在 tool-loop 里碰巧调 get_memory。
 *
 * 设计要点：
 * - 不阻塞主流程：出错/超时/未启用一律静默返回空字符串，system 提示词退化为无记忆版本。
 * - 开关：localStorage `cyber-recall-v1`，默认开启；与自动捕获开关相互独立。
 * - 依赖 MCP Relay 的 memory 服务器提供 search_memory；Relay 不可用时自动降级。
 */

import { MCPClient } from "./mcpClient.js";

const LS_KEY = "cyber-recall-v1";
const mcp = new MCPClient(); // 默认 /api/mcp（同源代理 → Node 侧 Relay）

export function isRecallEnabled() {
  try {
    return localStorage.getItem(LS_KEY) !== "0";
  } catch (e) {
    return true;
  }
}

export function setRecallEnabled(on) {
  try {
    localStorage.setItem(LS_KEY, on ? "1" : "0");
  } catch (e) {
    /* 忽略 */
  }
}

/**
 * 检索与该用户问题相关的长期记忆，返回可注入 system 提示词的 <memory> 文本段。
 * @param {string} userText 用户本轮消息
 * @param {object} [opts]
 * @param {number} [opts.limit=8] 最多召回条数
 * @returns {Promise<string>} 命中为空或出错时返回 ""
 */
export async function recallMemories(userText, { limit = 8 } = {}) {
  if (!isRecallEnabled()) return "";
  if (!userText || !userText.trim()) return "";
  try {
    const res = await mcp.callTool("search_memory", { query: userText, limit });
    if (res.isError) return "";
    const entries =
      (res.raw && res.raw.structuredContent && res.raw.structuredContent.entries) || [];
    const lines = (entries || [])
      .filter((e) => e && e.key && e.value)
      .map((e) => `- ${e.key}: ${e.value}`);
    if (!lines.length) {
      console.log(`[recall] 无命中 → "${userText.slice(0, 40)}"`);
      return "";
    }
    console.log(`[recall] 命中 ${lines.length} 条 → "${userText.slice(0, 40)}"`);
    console.log(`[recall] 召回内容:\n${lines.join("\n")}`);
    return (
      "<memory>\n" +
      "以下是已知的、与该用户相关的长期记忆（跨会话保留），回答时请优先参考：\n" +
      lines.join("\n") +
      "\n</memory>"
    );
  } catch (e) {
    return "";
  }
}
