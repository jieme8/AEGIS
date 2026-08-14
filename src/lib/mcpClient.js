/**
 * 浏览器侧 MCP 门面。
 *
 * 浏览器无法直接 spawn stdio 型 MCP 服务器，也无法安全持有其凭据，因此所有
 * 真实连接都发生在 Node 侧的 MCP Relay。本类只负责经同源 /api/mcp 代理做 HTTP
 * 通信、超时与错误归一化，是 UI 与 Relay 之间的薄封装。
 *
 * 设计要点：
 * - 可注入 `fetchFn`，便于在 Node 单测中用 mock 替代（无需真实网络 / 真实服务器）。
 * - listTools() 返回「扁平 tools 列表」（每项带 server 字段），适配 Relay 的聚合接口。
 * - toOpenAITools() 把 MCP 工具声明转换为 OpenAI function 格式，直接塞进请求体。
 */

export class MCPClient {
  /**
   * @param {string} [baseUrl="/api/mcp"] 同源代理前缀（不带结尾斜杠）。
   * @param {object} [opts]
   * @param {Function} [opts.fetchFn] 注入的 fetch 实现（默认使用全局 fetch）。
   * @param {number} [opts.timeoutMs] 请求超时（毫秒），默认 15000。
   */
  constructor(baseUrl = "/api/mcp", opts = {}) {
    this.baseUrl = (baseUrl || "/api/mcp").replace(/\/$/, "");
    this.fetchFn =
      opts.fetchFn || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    this.timeoutMs = opts.timeoutMs || 15000;
  }

  /** 拉取所有已连接服务器的工具（扁平列表，每项带 server 字段） */
  async listTools() {
    const data = await this._request("GET", "/list");
    return (data && data.tools) || [];
  }

  /**
   * 拉取每个声明服务器的运行时状态（用于 MCP 列表界面）。
   * @returns {Promise<{ok:boolean, generatedAt:string, servers:Array, summary:object}>}
   */
  async getStatus() {
    const data = await this._request("GET", "/status");
    return data || { ok: false, servers: [], summary: { total: 0, connected: 0, disabled: 0, error: 0, usable: 0 } };
  }

  /**
   * 把 MCP 扁平工具列表转换为 OpenAI function 工具声明数组。
   * @param {Array} tools 来自 listTools() 的结果。
   */
  static toOpenAITools(tools) {
    return (tools || []).map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description || "",
        parameters: t.inputSchema || { type: "object", properties: {} },
      },
    }));
  }

  /**
   * 调用一个工具。
   * @param {string} name 工具名（与 listTools 中的 name 一致）。
   * @param {object} args 工具入参对象。
   * @returns {Promise<{content: string, isError: boolean, raw: object}>}
   */
  async callTool(name, args = {}) {
    const data = await this._request("POST", "/call", { name, arguments: args });
    const content =
      typeof data?.content === "string" ? data.content : JSON.stringify(data?.content ?? "");
    return { content, isError: !!data?.isError, raw: data };
  }

  _request(method, path, body) {
    if (!this.fetchFn) return Promise.reject(new Error("当前环境不支持 fetch"));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const init = {
      method,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
    };
    if (body != null) init.body = JSON.stringify(body);

    return Promise.resolve(this.fetchFn(this.baseUrl + path, init))
      .then(async (res) => {
        clearTimeout(timer);
        let data = null;
        try {
          data = await res.json();
        } catch (e) {
          /* 非 JSON 响应，data 保持 null */
        }
        if (!res.ok) {
          const msg =
            (data && (data.error || data.message)) || `HTTP ${res.status}`;
          throw new Error(msg);
        }
        return data;
      })
      .catch((err) => {
        clearTimeout(timer);
        if (err && err.name === "AbortError") {
          throw new Error(`MCP 请求超时（${this.timeoutMs}ms）`);
        }
        throw err;
      });
  }
}
