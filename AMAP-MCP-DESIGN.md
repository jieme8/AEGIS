# 高德地图 MCP 接入设计 · J.A.R.V.I.S. Cyber Audio Spectrum

> 版本：v1 · 2026-08-17
> 状态：**设计已定稿，待实施**（用户选择先存档、暂不改动工程）
> 目标：把高德地图（Amap）的位置服务能力接入现有 MCP 管线，使 LongCat Agent 具备地理编码、路径规划、POI 搜索、天气查询等真实工具调用。

---

## 0. 摘要 / 关键结论

- **现有管线已天然支持**：MCP Relay（:8787）+ `/api/mcp` 同源代理 + 浏览器 `mcpClient` + `agentLoop` tool-loop 都已就位。**新增一个地图服务器几乎不需要写编排代码**。
- **接入本质** = 在 `mcp.config.json` 增加一个 stdio server（`@amap/amap-maps`）+ 在 `.env` 写入 `AMAP_MAPS_API_KEY`（高德「Web 服务」类型）。Relay 经 `process.env` 注入子进程，**无需改 Relay 代码**。
- **浏览器侧**：
  - Phase 1（零 UI 改动）：复用现有 trace「05 工具调用」面板展示结果，对话里是模型综合后的自然语言答案。
  - Phase 2（可选增强）：加一个「地图」浮层，用高德 JS API 2.0 把坐标/路线渲染出来。
- **坐标系**：高德全系 **GCJ-02**。MCP 返回 GCJ-02，JS API 也吃 GCJ-02，**无需任何坐标转换**。
- **合规**：高德在白名单；渲染只能用高德/腾讯/百度/天地图，**禁用 Google / OpenStreetMap / Mapbox**。

---

## 1. 与现有架构的契合点（为什么改动这么小）

| 现有组件 | 文件 | 对高德接入的意义 |
|---|---|---|
| `buildStdioParams` | `server/mcp-relay.mjs` | 已把 `env: process.env` 整体传给每个 stdio 子进程；只要 `.env` 里有 `AMAP_MAPS_API_KEY`，高德 MCP 自动拿到，**无需改 Relay**。 |
| `loadDotEnv` | `server/mcp-relay.mjs` | 启动时把项目根 `.env` 的键值写入 `process.env`（仅当未设置时），正是密钥注入通道。 |
| `toOpenAITools` | `src/lib/mcpClient.js` | 把 `listTools()` 的扁平工具列表转成 OpenAI function 声明，直接进请求体——`maps_*` 工具自动可用。 |
| `agentLoop` tool-loop | `src/lib/agentLoop.js` / `toolCalls.js` | 检测 `tool_calls` → 调 Relay → 回填 → 重试（≤5 次迭代、错误兜底）已封顶，开箱即用。 |
| trace「05 工具调用」 | `src/components/chat/trace/TraceMcpTools.jsx` | 已展示 server/工具/入参/返回，高德工具无需单独 UI 即可观测。 |
| `/api/mcp` 代理 | `vite.config.js` | 已转发完整路径到 `localhost:8787`，浏览器不暴露任何密钥。 |

> 经验证：当前 `mcp.config.json` 已启用 `fetch` + `search`（Tavily），`memory` 待启用。高德作为第三个服务器加入，沿用「逐个安装、先 `disabled` 后开启、逐一验证」的 D2 纪律即可。

---

## 2. 服务器选型与工具清单

**首选官方包 `@amap/amap-maps`**（`npx -y @amap/amap-maps`，高德官方维护）。暴露 12 个 `maps_*` 工具，前缀天然避免与 Tavily 的 `search`/`search_*` 工具重名：

| 类别 | 工具 | 说明 |
|---|---|---|
| 地理编码 | `maps_geo` | 结构化地址 → 经纬度（支持地标/景区/建筑名解析） |
| | `maps_regeocode` | 高德经纬度 → 行政区划地址 |
| | `maps_ip_location` | IP 粗略定位（城市级） |
| 路径规划 | `maps_direction_driving` | 驾车（小客车/轿车，含路况静态估算） |
| | `maps_direction_walking` | 步行（100km 内） |
| | `maps_bicycling` | 骑行（500km 内，含天桥/单行/封路） |
| | `maps_direction_transit_integrated` | 公交换乘（跨城） |
| | `maps_distance` | 多模式距离/时间测量（多起点批量） |
| POI | `maps_text_search` | 关键词 POI 搜索（餐厅/酒店/加油站…） |
| | `maps_around_search` | 周边半径搜索 |
| | `maps_search_detail` | POI 详情（按 ID） |
| 天气 | `maps_weather` | 按城市名或 adcode 查天气 |

**社区备选 `amap-maps-mcp`（longyuan1996）**：同样 `npx -y amap-maps-mcp`、同 env 名 `AMAP_MAPS_API_KEY`，路径规划走 v5（2.0 接口），支持 16 种驾车策略、途经点、车牌限行规避等。仅当官方包在目标环境拉取异常时作为等价替换。

> 两者坐标系均为 GCJ-02；高德当前**实时路况需企业版权限**，免费接口为静态时间估算——设计上不依赖实时路况。

---

## 3. 配置改动（最小集）

### 3.1 `mcp.config.json` 新增条目

```json
{
  "name": "amap",
  "enabled": false,
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@amap/amap-maps"],
  "toolCallTimeoutMs": 20000,
  "_note": "官方高德 MCP。需 AMAP_MAPS_API_KEY(高德「Web 服务」类型) 写入项目 .env；Relay 经 process.env 注入子进程，无需改 relay 代码。npx 不可用时退回社区 amap-maps-mcp(同 env 名)。"
}
```

> 起步 `enabled: false`，按 D2 纪律先验证再置 `true`；与其它服务器并存，互不影响。

### 3.2 项目根 `.env` 追加

```
AMAP_MAPS_API_KEY=你的高德Web服务Key
```

### 3.3 可选增强（非必须）：按 server 隔离 env

当前 `buildStdioParams` 把**整个** `process.env` 传给每个子进程（高德会忽略无关键 `TAVILY_API_KEY` 等，无害）。若追求最小暴露面，可给 server spec 增加可选 `env` 字段并在 `buildStdioParams` 中 `{ ...process.env, ...(spec.env||{}) }` 合并。仅作加固，不影响功能。

---

## 4. 两个 Key 的区分（关键坑）

| | Key A · `AMAP_MAPS_API_KEY` | Key B · 高德 JS API Key |
|---|---|---|
| 开放平台类型 | **Web 服务** | **Web 端（JS API）** |
| 用途 | 给 MCP 服务器调用高德 Web Service API | 仅 Phase 2 浏览器地图渲染 |
| 落在哪里 | Relay 进程 / `.env`，**永不进前端** | 浏览器 `<script>` 加载 JS API（占位符 + Referer 白名单） |
| 配额 | 5000 次/日/接口（免费） | 按 JS API 配额 |

> ⚠️ **两者不能混用**，否则高德返回 `INVALID_USER_KEY`。设计上 Key A 走服务端、Key B 走前端，职责分离。

---

## 5. 浏览器侧集成

### Phase 1 — 仅 MCP 服务（推荐先落地，零 UI 代码）

- 不动 `agentLoop` / `mcpClient` / trace 组件。
- 连上后 `listTools()` 聚合出 12 个 `maps_*` → `toOpenAITools()` 进请求体 → 模型自行决定是否调用 → Relay 按名路由 → 结果回填。
- 观测点：trace「05 工具调用」段展示 server=`amap` / 工具 / 入参 / 返回；对话呈现模型综合答案。
- 降级：MCP 断连/超时不影响基础对话，trace 标 `mcp-unavailable`（现有兜底已覆盖）。

### Phase 2 — 地图渲染浮层（可选增强）

新增「地图」浮层，读取 tool-loop 拿到的坐标与路线 polyline，用 **高德 JS API 2.0（GL）** 渲染标记点与路线。

**合规要点（非默认场景，用户已点名高德）**：
- key 使用显式占位符，且**不预置任何可用 key**：
  ```html
  <script src="https://webapi.amap.com/maps?v=2.0&key=Please%20apply%20for%20your%20own%20key%20at%20the%20%E9%AB%98%E5%BE%B7%E5%BC%80%E6%94%BE%E5%B9%B3%E5%8F%B0%20and%20replace%20this%20placeholder"></script>
  ```
- 在高德开放平台控制台为该 JS API Key 配置 **Referer 白名单**（个人使用防嗅探；商业使用必须后端代理鉴权）。
- 坐标系 GCJ-02，与 MCP 返回一致，**直接 `new AMap.LngLat(lng, lat)` 绘制，无需转换**。
- 渲染合规红线：国界、台湾、南海诸岛按国家标准绘制；不标军事禁区/未公开敏感坐标；批量点位遵守《个人信息保护法》（个人签到坐标仅存本地私有存储）。

**初始化示意（占位 key，待用户替换）**：
```html
<div id="amap-map" style="width:100%;height:360px"></div>
<script>
  // key 占位符需替换为用户自己的「Web 端(JS API)」Key，并在高德控制台配 Referer 白名单
  const map = new AMap.Map('amap-map', { zoom: 12, center: [116.397, 39.908], viewMode: '2D' });
  // 工具结果中的 GCJ-02 坐标可直接绘制，例如 POI 标记：
  // new AMap.Marker({ map, position: [lng, lat], title: '...' });
  // 路线 polyline：new AMap.Polyline({ map, path: [[lng,lat], ...], strokeColor:'#39d0d8' });
</script>
```

---

## 6. 合规红线（已用合规守卫核对）

- **允许的渲染源**：高德 / 腾讯 / 百度 / 天地图。其余（Google Maps、Apple Maps、Bing 海外版、OpenStreetMap 直连海外瓦片、Mapbox、Leaflet+OSM 等）一律禁止。
- 本设计选高德：MCP 底层即高德 Web Service（持审图号、合规）；Phase 2 渲染也用高德 JS API——端到端合规。
- 绝不在前端硬编码/夹带任何可用地图 key；Key B 用占位符 + Referer 白名单。

---

## 7. 坐标系与坐标转换

- 高德系 **GCJ-02（火星坐标）**，格式 `lng,lat`（经度在前），与 WGS-84（GPS 原始）不同。
- 绝大多数场景：用户输入是**地址/城市名**，经 `maps_geo` 编码成 GCJ-02，无需转换。
- 若上游数据是 **GPS/WGS-84 坐标**，必须先经高德坐标转换 API 转 GCJ-02 再喂给 MCP/JS API；当前 `@amap/amap-maps` 工具集未直接暴露转换接口，需要时走 `maps_regeocode` 辅助或单独调用高德「坐标转换」Web API。

---

## 8. 风险与回退

- **网络依赖**：Relay 首次 `npx -y @amap/amap-maps` 需访问 npm registry；运行时需访问 `restapi.amap.com`。本沙箱若按 `fetch`/`memory` 的历史情况被挡，本地开发机正常；**完全离线则 MCP 无法工作**（必须连高德）。
- **配额**：高德 Web 服务免费 5000 次/日/接口，Demo 足够；生产需评估并可能升级。
- **工具循环上限**：`agentLoop` 已封顶 ≤5 次迭代 + 错误兜底，恶意/异常工具调用不会导致无限循环。
- **降级**：MCP 不可用 → 回落「无工具对话」，trace 标 `mcp-unavailable`，基础对话不受影响。

---

## 9. 验收标准

1. 起 Relay（`npm run mcp-relay` 或 `dev:all`）后，浏览器查 `/api/mcp/status` 应显示 `amap` 为 `connected`、含 12 个工具。
2. 提问「从北京南站到首都机场怎么坐车最快」→ 模型调 `maps_direction_transit_integrated` → trace「05 工具调用」出现该调用 → 给出方案。
3. 提问「上海外滩附近评分高的火锅店」→ 调 `maps_around_search` → 结果正确返回并呈现。
4. 提问「杭州市今天天气」→ 调 `maps_weather` → 返回天气。
5. Phase 2（若实施）：路线/POI 在高德 JS API 地图面板正确绘制（GCJ-02 直绘，无偏移）。
6. 高德 Key 缺失/无效时：trace 标错误，对话降级，`mcp-unavailable` 不崩。

---

## 10. 实施步骤（若后续执行）

1. **S1 配置**：`.env` 追加 `AMAP_MAPS_API_KEY`；`mcp.config.json` 加 `amap` 条目（`enabled:false`）。
2. **S2 启用验证**：置 `enabled:true` 并重启 Relay；查 `/api/mcp/status` 确认 connected + 12 工具。
3. **S3 对话验证**：按第 9 节用例逐条验证（地理编码 / 公交 / 周边 / 天气）。
4. **S4（可选）地图面板**：按第 5 节 Phase 2 加高德 JS API 2.0 浮层，占位 key + Referer 白名单说明，验证 GCJ-02 直绘。
5. **S5 收尾**：更新 `MCP-INTEGRATION-PLAN.md` 的能力对照表（新增「位置服务 / 路径规划 / POI / 天气」行）。
