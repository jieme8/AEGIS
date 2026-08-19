# J.A.R.V.I.S. 项目全景分析与完善方案

> 分析对象：`C:\Users\Administrator\ai\sound`（Vite + React 18 纯前端 SPA + Node 侧 MCP 中继）
> 分析时间：2026-08-18
> 状态：定位已从「赛博音频可视化器」演化为 **多功能 AI Agent 桌面应用**；功能面广、代码量大，但**缺乏统一产品定位与可部署性设计**。本文给出诊断 + 分阶段完善路线图，落地前需你拍板若干方向性决策。

---

## 1. 项目全景

| 维度 | 现状 |
|---|---|
| 产品定位 | 赛博朋克音频频谱可视化器 → 叠加 AI 对话 / MCP 工具 / 生图 / 影视搜索 / 油价 / 地图 / 视频(未做) 的**多功能 Agent Demo** |
| 技术栈 | Vite 5 + React 18（纯前端 SPA），生产依赖仅 `react`/`react-dom`；Node 侧 7 个 `.mjs` 中继服务（`@modelcontextprotocol/sdk` + 自研） |
| 代码规模 | 前端 `src/` ≈ 14.6k 行（73 文件）+ 服务端 `server/` ≈ 2k 行（8 文件）+ 测试/脚本 5 文件 |
| 入口链路 | `index.html` → `main.jsx`（挂载 `window.SpectrumEngine`，刻意不用 StrictMode）→ `App.jsx`（命令式编排 ~12 个浮动窗口，经 `window` CustomEvent 通信） |
| 外部通信 | 浏览器 → Vite **同源代理** `/api/*`（dev/preview 共用）→ Node 服务；密钥只在服务端注入，不下发前端 |
| 测试 | `npm test`：引擎断言 + sse/toolCalls/mcp 单测（mock fetch）；地图/记忆测试需真实 Relay，**未纳入 CI** |
| 部署 | **仅 localhost 开发态**；无真实部署方案，无 Docker，无前端路由/后端常驻 |

**核心判断**：功能堆得很满，但项目身陷"localhost 全家桶"形态——前端 + 5~7 个 Node 进程 + 一堆 `.env` 密钥，没有一条干净的发布路径。这是后续所有完善工作的前提约束。

---

## 2. 架构现状（模块地图）

```
Browser SPA (React)
 ├─ useVizEngine (687行)        频谱/圆环/黑客流 canvas 渲染，暴露 window.CyberFx / SpectrumAPI
 ├─ useChatController (1500行)   ★核心上帝模块：聊天+SSE+agent-loop+地图+影视+生图+记忆+指令
 ├─ useDraggableHud / useDevOverlay
 ├─ components/viz/*  频谱画布/标题栏/形态切换/Provider切换/图片窗/地图卡/流量图/WebViewer
 ├─ components/chat/* 对话面板/Trace×5浮层/TravelWizard
 ├─ components/mcp/*  McpPanel
 └─ lib/*  providerManager / mcpClient / agentLoop / image* / movie* / locationExtractor
            / amapJsApi / autoMemory / recall / answerVerifier / sse / toolCalls / webViewer / oilPrice

Node 中继 (server/*.mjs)              端口
 ├─ mcp-relay                          8787   MCP client，聚合 tools/list + tools/call
 ├─ mcp-fetch / mcp-memory             子进程  fetch + 自研跨会话记忆（已启用）
 ├─ movie-search / movie-meta         8789/8790  影视搜索 + 元数据（已启用）
 ├─ image-proxy                       8788   真实生图（SenseNova/Agnes，provider=http 时才需）
 └─ oilApi                            8795   全国92#汽油实时零售价

已接入 MCP 服务器（mcp.config.json，全部 enabled）：fetch / memory / search(Tavily) / amap
```

**通信契约**：React 各窗口靠 `jarvis:map-*` / `jarvis:image-*` / `WEBVIEWER_EVENT` 等 CustomEvent 解耦；LLM 工具循环由 `agentLoop.js` 编排（≤5 次迭代 + 错误兜底）。

---

## 3. 功能清单（已落地 / 部分 / 仅设计）

| 功能 | 状态 | 说明 |
|---|---|---|
| 音频频谱可视化（核心） | ✅ 完成 | 引擎单测 10/10 通过，DOM 契约 1:1 还原 |
| AI 对话（LongCat + 阿里 Qwen 多供应商） | ✅ 完成 | PROFILES 架构，manual-only 切换，同源代理 |
| MCP 工具调用（fetch/memory/search/amap） | ✅ 完成 | Relay + tool-loop + trace「05 工具调用」已验证 |
| 对话位置自动地图标注 | ✅ 完成 | locationExtractor + amapJsApi + MapCard（内联卡），16/16 单测 |
| 生图（local + http 双后端） | 🟡 部分 | 代码完整，但 `provider="http"` 而默认 `npm run dev` 不启 image-proxy → **静默失败** |
| 影视搜索 / 元数据 | ✅ 完成 | 4 类分组返回 + 种子库 |
| 油价看板 | ✅ 完成 | 全国92#实时价 |
| 旅行向导 TravelWizard | ✅ 完成 | |
| 响应式布局 | ✅ 完成 | 四档断点（1099/900/640/420），大屏 1:1 还原 |
| **视频功能** | ⬜ 仅设计 | `VIDEO-FEATURE-DESIGN.md` 完整规格，**src 中零实现** |
| 地图全局浮层 MapPanel（Phase 2 增强） | ⬜ 未做 | 仅内联 MapCard，全局汇总浮层未做 |
| MCP Phase 2（filesystem + spectrum-bridge + 管理面板） | ⬜ 未做 | 当前 fetch/memory/search/amap 够用 |
| 真实部署 / 发布 | ⬜ 未做 | 仅 localhost |

---

## 4. 问题诊断（按严重度排序）

### 🔴 P0 — 阻断性 / 高危

**① 凭证泄露进前端 bundle（真实风险）**
- `VITE_LONGCAT_API_KEYS`（LongCat 多 key）、`VITE_QWEN_API_KEY`（阿里）、`VITE_AMAP_JS_KEY`、`VITE_AMAP_JS_SECURITY` 均带 `VITE_` 前缀 → **打包进浏览器**。
- 其中 `VITE_AMAP_JS_SECURITY` 是高德 JS API **安全密钥**（`.env` 里有真实值 `ec79c56…`），本应仅服务端持有；设计文档承诺"占位符 + Referer 白名单"，实际却打了真实值且进前端。任何人查看源码即可拿走。
- LongCat 已在 `vite.config` 支持服务端注入密钥（`proxyReq` 注入 `LONGCHAT_API_KEY`），但前端仍自带 Authorization 透传 → 可完全改为纯服务端注入，前端不再持 key。

**② 运行态不可靠：默认脚本缺服务**
- `npm run dev` 启动 vite+relay+movie-search+movie-meta+oilApi，**缺 image-proxy(8788)**；而 `imageConfig.provider="http"` → 生图请求打到死端口，**静默失败**。
- `npm run preview` 只启 vite preview + oilApi → MCP(8787)/movie(8789/8790)/image(8788) **全不在线** → 预览态下绝大多数功能 404/拒绝连接。
- MCP/fetch/memory/search/amap 在 preview 下全部失效，等于"发布即残废"。

### 🟠 P1 — 架构 / 可维护性

**③ 上帝模块 `useChatController.js`（1500 行）**
- 混合 DOM 操作 + React 状态 + 6 个子系统（聊天/地图/影视/生图/记忆/指令），改动风险高、无法单测。是最大的技术债。

**④ 重复逻辑**
- `escapeHtml` 在 `useChatController:1307` 与 `movieMeta.js` 各定义一份；拖拽逻辑 `makeDraggable`（mouse 版）vs `useDraggableHud`/`MapWindow`（pointer 版）重复。

**⑤ 死代码 / 噪音**
- 根目录 `debug-map.html`、`dist-tmp/`（旧构建）应清理；`mcp.config.json` 把 prose 塞进 `_note` 字段（无害但碍眼）。

**⑥ 测试软约束**
- `scripts/clscheck.mjs` 只打印未匹配类名、**不 fail** → `npm run verify` 形同虚设；地图/记忆测试被排除在 `npm test` 之外。

### 🟡 P2 — 体验 / 完整性

**⑦ XSS 姿势**：气泡正文走 `textContent`（安全）；`appendRichMessage` 用 `innerHTML` 但喂的是 `escapeHtml` 清洗后的渲染结果（注释声称安全，建议补一个测试固化）。

**⑧ 本地服务无鉴权**：image-proxy/movie/oil 监听 localhost，单机无碍；但一旦端口被暴露即成"付费 API 开放中继"（密钥在服务端，端点开放）。部署前必须加绑定/防火墙或统一网关。

---

## 5. 完善方案（分阶段路线图）

> 原则：**先止血（P0）→ 再加固（P1 安全）→ 治理架构（P1 架构）→ 补齐功能（P2）→ 测试部署（P3）**。每阶段可独立验收。

### 阶段 A — 运行完整性（止血，1~2 天）
| 动作 | 旧 | 新 |
|---|---|---|
| 统一服务清单 | dev/preview 各自硬编码启动子集 | 抽一个 `server-manifest`（端口+命令），`dev`/`preview` 按清单并行拉起全部依赖服务 |
| image-proxy 缺口 | `provider=http` 但 dev 不启 8788 | dev/preview 默认启 image-proxy；或把 `provider` 默认回 `local`（离线可跑、零密钥） |
| 代理死端口兜底 | 服务不在 → 请求挂起/404 无提示 | 各 `/api/*` 代理加 `proxyRes` 健康检查，死端口时前端明确提示"服务未启动"而非静默失败 |
| 验收 | — | `npm run dev` / `npm run preview` 下 6 大功能均可达 |

### 阶段 B — 安全加固（高危，半天~1 天）
| 动作 | 旧 | 新 |
|---|---|---|
| LongCat 鉴权 | 前端持 `VITE_LONGCAT_API_KEYS` 自带 Bearer | 前端**只发 profile id**；`/api/longcat` 服务端按 id 取 `.env` 密钥注入（现有 `proxyReq` 已支持，去掉前端透传分支） |
| 高德 JS 密钥 | `VITE_AMAP_JS_KEY`/`VITE_AMAP_JS_SECURITY` 进 bundle | 新增 `/api/amap-js` 同源端点，由 Node 从 `.env` 注入 **JS Key + 安全密钥**到页面（或走高德「安全密钥服务端代理」方案）；前端不再出现真实值 |
| 密钥轮换 | `.env` 真实 key 已存在 | 确认 `.env` gitignored（已忽略）；`.env.example` 仅留占位；建议轮换已暴露的 LongCat/Qwen/高德 key |
| 验收 | — | 浏览器源码搜索不到任何 `sk-`/`ak_`/`ec79…` 真实密钥 |

### 阶段 C — 架构治理（可维护性，2~3 天）
1. **拆分上帝模块**：把 `useChatController` 按子系统拆成可组合的 hook/controller（chat / maps / movie / image / memory / command），保留现有 DOM 契约与 CustomEvent 通信，不动视觉。
2. **收敛重复**：`escapeHtml` 提到 `src/lib/sanitize.js` 单一来源；拖拽统一到 `useDraggableHud`（pointer 版），删除 mouse 版 `makeDraggable`。
3. **清理**：删 `debug-map.html`、`dist-tmp/`；`mcp.config.json` 的 `_note` 移到独立 README 或注释。
4. 验收：`npm test` 全绿；拆分后行为与原版一致（回归靠现有引擎/解析单测 + 手动预览）。

### 阶段 D — 功能补齐（按决策取舍）
- **视频功能**：规格已就绪（`VIDEO-FEATURE-DESIGN.md`），零实现。是否做？做则按 P0~P3 落地（IndexedDB + 内联 `<video>` + VideoWindow）。
- **地图全局浮层 MapPanel**：内联 MapCard 已够用，全局汇总属锦上添花，可选。
- **MCP Phase 2**（filesystem + spectrum-bridge + 管理面板）：当前 4 个 MCP 服务器已覆盖联网/记忆/搜索/地图，除非有明确需求，建议暂缓。

### 阶段 E — 测试与质量（1~2 天）
- `clscheck.mjs` 改为**发现漂移即非零退出**，`verify` 真正生效。
- 地图/记忆测试加 `process.env` 守卫，能在有 Relay + key 的 CI 环境纳入；无环境则跳过并标注。
- 补 1 个 React 冒烟测试（若装了浏览器二进制）或 jsdom 渲染 `App` 不崩溃。
- 固化 XSS：`appendRichMessage` 加一条"恶意 `<script>` 被转义"的断言。

### 阶段 F — 部署与发布（方向上的大头，视决策）
- **方案选型**：① 单 Node 进程聚合（relay+movie+meta+image+oil 合并为一个服务，前端 `vite build` 静态托管）；② Docker Compose 编排多服务；③ 仅做本地 Demo 不部署。
- 前置代理必须转发 `/api/*` 到对应后端（设计文档已写明，需落成配置模板）。
- 产出 `DEPLOY.md` + `.env.example` 完整化 + 去 localhost 硬编码假设。

---

## 6. 优先级矩阵

| 阶段 | 价值 | 成本 | 紧迫度 | 建议 |
|---|---|---|---|---|
| A 运行完整性 | 高 | 低 | 🔴 立即 | 必做 |
| B 安全加固 | 极高 | 低 | 🔴 立即 | 必做（密钥已暴露） |
| C 架构治理 | 中 | 中 | 🟠 近期 | 必做，降低后续改动风险 |
| D 功能补齐 | 视需求 | 中~高 | ⚪ 待定 | 等你拍板 |
| E 测试质量 | 中 | 低 | 🟠 近期 | 必做 |
| F 部署 | 高 | 高 | ⚪ 视定位 | 取决于决策① |

---

## 7. 需要你拍板的决策

1. **产品定位**：继续当作 **localhost 开发 Demo**，还是要**真实部署上线**？→ 决定阶段 F 与 B 的投入深度。
2. **生图默认后端**：保持 `http`（需 `dev:all`）还是默认 `local`（离线零密钥）？→ 决定阶段 A 的默认体验。
3. **视频功能**：是否开做？（规格齐备，零代码）主模式确认：用户上传优先 or AI 文生优先？
4. **MCP Phase 2**：是否需要 filesystem / spectrum-bridge / 管理面板？当前 4 个服务器是否够用？
5. **密钥已暴露**：是否同意立即轮换 `.env` 中 LongCat / Qwen / 高德 的真实密钥（配合阶段 B 去前端化）？

---

## 8. 建议的第一步

无论方向如何，**阶段 A + B 是零争议的「止血+排雷」**，建议优先执行：
- 让 `dev`/`preview` 一键拉起全部依赖服务（或把生图默认回 `local`）；
- 把 LongCat / 高德 JS 密钥改为纯服务端注入，前端源码不再含真实密钥，并轮换已暴露的 key。

确认上述决策（尤其第 1、5 点）后，我可按阶段给出分步执行计划并落地。你也可以直接指定「先做 A+B」或「只做某一阶段」。
