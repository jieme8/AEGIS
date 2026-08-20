# MCP 集成计划文档 · J.A.R.V.I.S. Cyber Audio Spectrum

> 版本：v2 · 2026-08-14（2026-08-14 修订：同步实际落地偏差）
> 状态：**Phase 1.1 已实施（fetch + Tavily 搜索接入，构建+测试通过，Relay 实测可抓网页；`memory` 尚未启用）**
> 目标：把当前「纯文本聊天助手」升级为「可调用外部工具的 Agent」，通过 Model Context Protocol 接入工具服务器。

---

## 0. 已确认决策（拍板项）

| # | 决策 | 说明 |
|---|------|------|
| D1 | **LongCat-2.0 支持 OpenAI 兼容 `tool_calls`** | 原方案的硬阻塞已解除，**无需更换模型**，按原 `MODEL_CONFIG` 继续。 |
| D2 | **第一期只装 `fetch` + `memory`**，`filesystem` 暂不接入 | 工具服务器**逐个安装、逐个验证**（先 `fetch`，后 `memory`）。 |
| D3 | **MCP 仅接入 React 工程（单实现）** | 独立 `audio-visualizer.html` 已于重构后期删除，功能仅保留在 React 工程，避免双平行实现维护漂移。 |
| D4 | **编排放浏览器侧** | 沿用现有「浏览器直连 LLM 流式」范式，Relay 只做 MCP client + HTTP 代理，不在服务端持有整段对话。 |
| D5 | 第二期再上 `filesystem` + 自研 `spectrum-bridge` + 管理面板 | 见第 6 节。 |

> **实施偏差（已落地，2026-08-14 补记）**
> - **Tavily 搜索 MCP 已先行接入**：原计划第一期仅 `fetch` + `memory`，但实际先装的是 `tavily-mcp`（`mcp.config.json` 中 `search` 已 `enabled`，Relay `/status` 可见，暴露 5 个 tavily 工具）。`fetch` 也已接入。→ 当前可用工具服务器为 `fetch` + `search`。
> - **`memory` 尚未启用**：`mcp.config.json` 中 `memory.enabled` 仍为 `false`，Phase 1.2 待执行（官方 `@modelcontextprotocol/server-memory` 已确认可用）。
> - **独立 `audio-visualizer.html` 已删除**：重构后期移除该单文件 Demo，功能统一保留在 Vite + React 工程（见 D3），不再存在"双平行实现"。

---

## 1. 背景与目标

当前 `useChatController` 仅做「用户输入 → LongCat 流式回复 → 本地模拟兜底」，模型无法调用任何外部能力。接入 MCP 后，LongCat 可在对话中发起 `tool_calls`，由 MCP 服务器执行真实动作（联网抓取、长期记忆等），结果回填后继续推理，使助手成为真正的工具型 Agent。

**对接目标（第一期）**
- 经 MCP 接入 `fetch`（联网/公开 API）与 `memory`（跨会话记忆）两个官方 stdio 服务器。
- 浏览器侧实现 tool-loop 编排：检测 `tool_calls` → 调工具 → 回填 → 再请求（含迭代上限与错误兜底）。
- trace 浮层新增「工具调用」段，可视化每一次工具调用的服务器/工具/入参/返回。
- 调工具期间 `CyberFx.thinking()`，最终回答 `CyberFx.output()`，频谱随 Agent 状态形变。

**非目标**：浏览器内 spawn stdio MCP（不可能）；模型协议层改造；业务数据库/自定义 API（留第二期）。

---

## 2. 技术现状（精简）

- **栈**：Vite 5 + React 18，纯前端 SPA。生产依赖仅 `react`/`react-dom`。
- **对话链路**：`useChatController.streamLongCat()` → `fetch` + `parseSSEChunk` → LongCat（OpenAI 兼容）。
  - dev：经 Vite 代理 `/api/longcat` 注入密钥、免 CORS（`vite.config.js`）。
  - prod：`sendAuthFromBrowser=true` 浏览器直连（密钥暴露，已有注释提示自建后端代理）。
- **首要缺口**：`src/lib/sse.js` 的 `parseSSEChunk` **只解析 `content` / `reasoning_content`，不解析 `tool_calls`**——必须扩展。
- **全局契约**：`window.SpectrumEngine` / `window.CyberFx`（default/thinking/output）/ `window.SpectrumAPI.snapshot()`。
- **单实现**：独立 `audio-visualizer.html` 已于重构后期删除，仅保留 Vite + React 工程；行为变更只需在一处进行。
- **测试**：`scripts/verify-engine.cjs`、`tests/sse.test.mjs`、`scripts/clscheck.mjs`，均为 Node-only（无 Playwright）。

---

## 3. 通信架构

```
                         ┌─────────────────────────────┐
                         │   Browser SPA (React)        │
                         │   useChatController          │
                         │   · 对话状态 · tool-loop 编排 │
                         └──────────────┬──────────────┘
                                        │ 同源 /api/*
                         ┌──────────────┴──────────────┐
                         │   Vite Dev Proxy /api/*      │
                         │   注入密钥 · 免 CORS         │
                         └──────┬───────────────┬──────┘
                  /api/longcat  │               │  /api/mcp
                                ▼               ▼
                       ┌────────────────┐  ┌────────────────────────┐
                       │  LongCat LLM   │  │  MCP Relay (Node)       │
                       │  tool calling  │  │  @modelcontextprotocol/ │
                       │                │  │  sdk (client)           │
                       └────────────────┘  └───────────┬────────────┘
                                                       │ stdio / SSE
                                                       ▼
                                            ┌────────────────────────┐
                                            │  MCP Servers            │
                                            │  fetch · memory (P1)    │
                                            │  filesystem · bridge(P2)│
                                            └────────────────────────┘
```

**Agent 单次对话工具循环**

```
用户提问 → LLM 请求(tools) → LLM 返回
                                ├─ 有 tool_calls → 调用 MCP 工具 → 回填结果并重试 LLM ─┐
                                └─ 无 tool_calls → 流式回答用户                        │
                                              ↑────────────── 循环（≤5 次）───────────┘
```

**各层职责**
- *Browser SPA*：tool-loop 编排、流式 `tool_calls` 解析、结果渲染。
- *Vite Dev Proxy*：同时转发 `/api/longcat` 与新增 `/api/mcp`，统一服务端注入密钥。
- *MCP Relay (Node)*：用官方 SDK 作 MCP client，连接各服务器，`tools/list` 聚合、`tools/call` 代理；是唯一能 spawn 子进程/持有凭据的地方。
- *MCP Servers*：实际工具提供方（fetch / memory / 后续 filesystem / 自研桥）。

---

## 4. 模块改造点

| 模块 / 文件 | 改造内容 | 所属期 |
|---|---|---|
| `src/config/modelConfig.js` | 新增 `toolsEnabled`、`mcpRelay:"/api/mcp"`、`supportsTools:true`（D1 已确认） | P1 |
| `src/lib/sse.js` | **核心缺口**：扩展 `parseSSEChunk` 累积 `delta.tool_calls[]`（按 `index` 重组 `id/type/function.name/function.arguments` 流式 JSON 碎片），输出 `toolCalls` | P1 |
| `src/lib/mcpClient.js`（新建） | 浏览器侧门面：`listTools()`→`GET /api/mcp/list`；`callTool(name,args)`→`POST /api/mcp/call`；超时 + 错误归一化 | P1 |
| `src/hooks/useChatController.js` | 请求体带 `tools`（会话前置拉取缓存）；`handleSend` 实现 tool-loop（含 ≤5 次迭代、错误兜底、与 `CyberFx` 形态联动）；断连标 `mcp-unavailable` | P1 |
| `src/components/chat/trace/TraceMcpTools.jsx` 等 5 个独立浮层 | trace 拆分为 5 个独立浮层（请求状态 / 附加上下文 / 提示词 / 思考过程 / **05 工具调用**），其中 `TraceMcpTools` 展示「工具调用」段：服务器/工具/入参/返回（可折叠、可复制） | P1 |
| `vite.config.js` | 新增代理 `/api/mcp` → `http://localhost:8787` | P1 |
| `server/mcp-relay.mjs`（新建） | Node 服务：官方 SDK 连接 `mcp.config.json` 服务器；`GET /api/mcp/list`、`POST /api/mcp/call`（按工具名路由） | P1 |
| `package.json` | 加 `@modelcontextprotocol/sdk`；新增 `mcp-relay`、`dev:all`（并行 vite + relay）脚本 | P1 |
| `tests/mcp.test.mjs`（新建） | mock relay 测 tool-loop 与 `mcpClient` | P1 |
| `tests/sse.test.mjs` | 扩展覆盖 `tool_calls` 流式重组 | P1 |
| `audio-visualizer.html` | **已删除**（重构后期移除独立 HTML，功能并入 React 工程，见 D3） | — |
| `server/mcp-relay.mjs`（扩展） | 接入 `filesystem`（限定目录）；新增自研 `spectrum-bridge`（浏览器上报 `SpectrumAPI.snapshot()`，桥以 MCP resource 暴露） | P2 |
| HUD / dev 面板 | `MODE` 连接成功后 `SIM→MCP`；可选 MCP 服务器管理面板 | P2 |

---

## 5. 配置方式

**`mcp.config.json`（Relay 读取，第一期仅启用 fetch + memory）**

```json
{
  "relayPort": 8787,
  "servers": [
    { "name": "fetch",  "enabled": true,  "transport": "stdio",
      "command": "npx", "args": ["-y", "@modelcontextprotocol/server-fetch"] },
    { "name": "memory", "enabled": false, "transport": "stdio",
      "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] }
  ]
}
```

> **逐个安装（D2）**：实施时先把待装服务器的 `enabled` 置 `true` 并验证通过，再开启下一个。即顺序为 fetch（enabled）→ 验证 → memory（enabled）→ 验证。

**第二期扩展（默认 disabled，待实施时开启）**

```json
{
  "servers": [
    { "name": "filesystem", "enabled": false, "transport": "stdio",
      "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/Administrator/ai/sound/workspace"] },
    { "name": "spectrum-bridge", "enabled": false, "transport": "stdio",
      "command": "node", "args": ["server/spectrum-bridge.mjs"] }
  ]
}
```

**凭据与安全**
- 所有凭据只存在于 Relay（服务端）与 `.env`，**绝不进前端 bundle**。
- `fetch` 建议加出网白名单/超时；`memory` 明确数据落盘路径（Relay 本地 JSON），避免污染用户目录。
- `MODEL_CONFIG` 增加 `toolsEnabled`/`mcpRelay`/`supportsTools`（D1 已确认 `supportsTools:true`）。

---

## 6. 实施步骤（分阶段，逐个安装）

### Phase 1.1 — 接入 `fetch`
1. 后端骨架：`npm i @modelcontextprotocol/sdk`；新建 `server/mcp-relay.mjs` 打通 `tools/list` + `tools/call`；`vite.config.js` 加 `/api/mcp`；加 `mcp-relay` / `dev:all` 脚本。
2. 配置：`mcp.config.json` 中 `fetch.enabled=true`、`memory.enabled=false`。
3. 浏览器门面 + 单测：新建 `src/lib/mcpClient.js`、`tests/mcp.test.mjs`（mock relay）。
4. SSE 改造：扩展 `parseSSEChunk` 支持 `tool_calls` 流式重组；`sse.test.mjs` 覆盖。
5. 编排接入：`useChatController` 实现 tool-loop；`modelConfig` 加开关。
6. 可观测：trace 浮层（`TraceMcpTools`）加「工具调用」段；`CyberFx` 形态联动。
7. **验证 checkpoint**：`npm run build` + `npm test`；手动起 relay，发一条需联网的提问（如「查一下今天的新闻头条」），确认工具被调用、结果回填、trace 显示、频谱进入 thinking→output。
8. ~~标注：`audio-visualizer.html` 顶部加「不含 MCP」~~（该独立 HTML 已删除，无需此步，见 D3）。

### Phase 1.2 — 接入 `memory`
1. 配置：`mcp.config.json` 中 `memory.enabled=true`。
2. 验证 Relay 已将其工具（`create_entities` / `search_nodes` 等）聚合进 `/api/mcp/list`。
3. **验证 checkpoint**：对话中让助手「记住我偏好极简中文」，新开会话验证偏好被召回；确认记忆落盘路径正确、无越权写。

### Phase 2 — `filesystem` + 自研 `spectrum-bridge` + 管理面板
1. `filesystem`：`mcp.config.json` 开启并**限定目录**；验证读写/搜索；确认无越权。
2. `spectrum-bridge`（自研 MCP server）：浏览器周期性把 `SpectrumAPI.snapshot()` 经 Relay 上报；桥以 MCP resource 暴露给 LLM，使助手能「读取实时频谱状态」。
3. 管理面板：HUD `MODE` 连接后 `SIM→MCP`；dev 面板展示已连接服务器与可用工具数，支持启停。
4. **验证 checkpoint**：助手可读取/写入限定目录文件；可引用当前实时频谱数据；面板状态与实际一致。

---

## 7. 助手能力对照

| 能力 | 现在 | 第一期（fetch+memory） | 第二期（+filesystem+bridge） |
|---|---|---|---|
| 纯文本对话 | ✅ | ✅ | ✅ |
| 联网查实时信息 / 公开 API | ❌ | ✅ | ✅ |
| 跨会话长期记忆 | ❌ | ✅ | ✅ |
| 本地文件读写/搜索 | ❌ | ❌ | ✅（限定目录） |
| 读取实时频谱状态 | ❌ | ❌ | ✅（自研桥） |
| 工具调用可视化（trace） | ❌ | ✅ | ✅ |
| 频谱随 Agent 形态联动 | ❌ | ✅ | ✅ |
| 断连优雅降级 | 本地模拟兜底 | 无工具对话兜底 | 同左 |

---

## 8. 风险与验证

- **安全**：Relay 可 spawn 任意命令，**必须**限定 `mcp.config.json` 来源与权限，禁止前端传入 server 定义；`fetch` 加出网白名单；`memory`/`filesystem` 锁定落盘目录。
- **验证**：交互级（动画/拖拽/真实工具调用）可用 `playwright-core` + 本机 Chrome 真实复现验证；逻辑层靠 Node 单测（`sse` / `mcp`）覆盖。
- **回退**：MCP 断连/超时不影响基础对话，自动回落「无工具对话」并在 trace 标 `mcp-unavailable`。
- **单实现（无双平行）**：D3 已定「MCP 仅 React 工程」，独立 `audio-visualizer.html` 已删除，不再存在镜像整套 tool-loop 的维护负担。

---

## 9. 验收标准

1. `npm run build` 通过；`npm test`（含新增 `mcp` / `sse` tool_calls 用例）通过。
2. 第一期：`fetch` 与 `memory` 分别独立验证通过（逐个安装，D2）。
3. 一条需要联网的提问能正确触发 `fetch` 工具、回填、流式回答，且 trace「工具调用」段完整。
4. 一条记忆偏好指令在跨会话后被正确召回。
5. 工具不可用时不崩，trace 标 `mcp-unavailable`，基础对话正常。
6. 独立 `audio-visualizer.html` 已删除，MCP 仅存在于 React 工程（见 D3）。
