# 对话位置自动地图标注 · J.A.R.V.I.S. Cyber Audio Spectrum

> 版本：v1 · 2026-08-17
> 状态：**已实施（2026-08-17 落地，构建通过 + 解析器单测 16/16 PASS）**
> 目标：chat-panel 对话框中，**每条用户输入 / AI 输出**，只要文本包含地址或位置信息，就自动调用高德 MCP 获取坐标，并在对话框内用高德 JS API 渲染地图、标注位置点（路线则画 polyline）。
> 前置：高德 MCP 已接入（Phase 1 完成，`mcp.config.json` 已加 `amap`，`.env` 已有 `AMAP_MAPS_API_KEY` Web 服务 Key，Relay 端 `maps_*` 工具可用）。本功能是 Phase 2（地图渲染）的**自动触发演进版**。

---

## 0. 摘要 / 关键结论

- **触发是核心新意**：不是「手动开地图面板」，而是对**每一轮对话的用户输入与 AI 回复文本**自动做位置实体抽取 → 命中即调高德 MCP → 渲染地图。
- **两个坐标来源合并去重**：
  1. **文本抽取**：正则 + 地名词典从消息文本里抠出地址实体 → 调 `maps_geo` 拿坐标。
  2. **工具调用**：AI 在 tool-loop 里自己调 `maps_geo` / `maps_weather` / `maps_direction_*` 时，工具返回的坐标/路线**直接喂给地图**（无需再抽取）。
- **渲染形态**：主用**消息内联地图卡片**（贴在含位置的 bubble 下方，最贴合「对话框里面」）；可选**全局地图浮层**汇总整轮对话所有位置。
- **坐标系 GCJ-02**：MCP 返回 GCJ-02，高德 JS API 也吃 GCJ-02，**直绘无偏移、无需转换**。
- **合规**：地图瓦片仅用高德 JS API（白名单内）；禁用 Google / OpenStreetMap / Mapbox；渲染用占位 Key B + Referer 白名单。

---

## 1. 整体架构

```
┌─────────────────────────── chat-panel 消息流 (useChatController) ───────────────────────────┐
│                                                                                              │
│  用户输入 appendMessage("user", raw)  ─┐                                                      │
│  AI 终态 bubble.finalize(text)        ├─► maybeShowMap(text, role)  [fire-and-forget]        │
│  AI 错误 appendMessage("ai", text)  ─┘       │                                                │
│                                                ▼                                              │
│                                    ① locationExtractor(text)                                │
│                                       抽取候选地址实体（正则+词典）                            │
│                                                │ 命中≥1                                        │
│                                                ▼                                              │
│                                    ② 地理编码：mcpClient.callTool("maps_geo",{address})    │
│                                       → GCJ-02 坐标 / adcode / level                         │
│                                                │                                              │
│   ┌──── AI tool-loop 里模型调 maps_* 工具 ────┘（来源②：工具返回的坐标/路线也喂地图）          │
│   │  executeTool() 解析返回 → pushMapMarkers()                                                  │
│   ▼                                                                                            │
│   ③ 渲染：amapJsApi 单例                                                                       │
│      - 内联 MapCard（贴在 bubble 下）：多 Marker + fitBounds                                    │
│      - 可选 MapPanel（全局浮层）：累积标注 + 路线 Polyline                                       │
│      高德 JS API 2.0（GL），GCJ-02 直绘                                                         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 位置实体抽取（新增 `src/lib/locationExtractor.js`）

零额外请求、低延迟，先做正则 + 地名词典；后期可升级为 LLM 辅助标注。

**识别模式（命中即视为位置候选）**
- 行政实体：`省|市|区|县|镇|乡` + `路|街|大道|巷|弄`
- 地标后缀：`大厦|大楼|广场|公园|景区|景点|车站|火车站|高铁站|机场|地铁站|大学|学院|医院|商场|购物中心|酒店|宾馆|小区|工业园|科技园`
- 句式：`在?(.+?)(附近|旁边|边上)`、`去(.+?)`、`到(.+?)`、`从(.+?)(出发|到)`、`(.+?)怎么走`、`(.+?)在哪里|在哪`
- 知名 POI 白名单（可选）：西湖、外滩、天安门、故宫、东方明珠…（可直接作为候选，减少误判）

**置信过滤（去噪）**
- 必须命中「明确行政/地标词」或「已知 POI」，纯代词（这里/那里/这边/本地）**不触发**。
- 候选长度下界（如 ≥2 字且含地名词），避免「路」「区」孤立词误触。
- 单条消息保留前 **N=3** 个去重候选（按出现顺序）。

**输出**：`[{ text:"杭州市西湖区", query:"杭州西湖区" }, …]`（`query` 为送 `maps_geo` 的干净地址串）。

---

## 3. 地理编码（复用现有 MCP 通道）

对每个候选调**现有封装** `mcpClient.callTool("maps_geo", { address: query })`（内部走 `/api/mcp/call` → Relay → 高德 Web Service，已验证可用）。

- 返回取第一个候选：`{ location:"120.264263,30.184119", adcode:"330109", level:"区县" }`。
- **路线**：若文本含「从A到B」「A到B怎么走」或 AI 调了 `maps_direction_*`，额外调对应方向工具拿 `polyline`（或直接从工具返回解析路径坐标数组）。
- 失败 / 超时（toolCallTimeoutMs 已设 25000）：**不阻塞对话**，降级为「仅地址文本卡片」，并在控制台 warn。

---

## 4. 渲染层（新增 `src/lib/amapJsApi.js` + `src/components/viz/MapCard.jsx` + 可选 `MapPanel.jsx`）

### 4.1 高德 JS API 2.0 加载（合规）
- 运行时**动态注入** `<script src="https://webapi.amap.com/maps?v=2.0&key=PLACEHOLDER">`（推荐动态注入，避免无 Key 时 index.html 静态报错；也可在 `index.html` 加占位 script）。
- Key 用**显式占位符**（不预置可用 key），并在高德控制台为该 JS API Key 配 **Referer 白名单**防嗅探：
  ```
  https://webapi.amap.com/maps?v=2.0&key=Please%20apply%20for%20your%20own%20key%20at%20the%20%E9%AB%98%E5%BE%B7%E5%BC%80%E6%94%BE%E5%B9%B3%E5%8F%B0%20and%20replace%20this%20placeholder
  ```
- **这是 Key B（Web 端 JS API）**，与 `AMAP_MAPS_API_KEY`（Key A，Web 服务，已在 .env）**不是同一个**，二者不可混用。

### 4.2 内联地图卡片（主形态）
- `appendMapCard(role, markers, route)`：在含位置的 bubble 之后命令式注入一个 `.map-card`（高德 JS API 小地图，默认 `340×200`）。
- 每个坐标 `new AMap.Marker({ position:[lng,lat], title:label })`；多址时 `map.setFitView(markers)` 自动框选。
- 路线（若有）：`new AMap.Polyline({ path:[[lng,lat],…], strokeColor:"#39d0d8" })`。
- GCJ-02 直绘，无需转换。

### 4.3 全局地图浮层（可选增强 / 汇总视图）
- `MapPanel`：经 Portal 挂 body 的独立浮层，自动弹出，累积标注整轮对话所有位置点（多 Marker）+ 路线；点击内联 `.map-card` 可放大定位到该浮层。
- 作为「全览」而非替代内联卡片。

### 4.4 单例与懒加载
- `amapJsApi` 维护地图 JS 加载 Promise 单例（只加载一次 script）；地图实例按卡片/浮层各自创建。
- 卡片用 `IntersectionObserver` 懒初始化，离屏不建图，省资源。

---

## 5. 接线点（代码层面，仅设计、不改）

`src/hooks/useChatController.js`：
- **L687** `appendMessage("user", raw)` 后追加：
  ```js
  maybeShowMap(raw, "user").catch(() => {});   // fire-and-forget，不阻塞发送
  ```
- **L803** `bubble.finalize(result.finalContent)` 后 + **L851** `appendMessage("ai", finalText)` 后追加：
  ```js
  maybeShowMap(result.finalContent /*或 finalText*/, "ai").catch(() => {});
  ```
  （AI 文本用 finalize 后的完整文本一次性抽取，避免流式中间片段误触发。）
- 新增 `maybeShowMap(text, role)`：
  ```js
  async function maybeShowMap(text, role) {
    const cand = locationExtractor(text);          // ① 抽取
    if (!cand.length) return;
    const markers = [];
    for (const c of cand) {
      try {
        const r = await mcpClient.callTool("maps_geo", { address: c.query });
        if (!r.isError) { const loc = parseGeo(r.content); markers.push({ ...loc, label: c.text }); }
      } catch {}
    }
    if (markers.length) appendMapCard(role, markers);   // ③ 内联卡片
  }
  ```
- **L776-784** `executeTool(name, args, callId)`：若 `name` ∈ `{maps_geo, maps_weather, maps_direction_driving, maps_direction_walking, maps_direction_transit_integrated, maps_text_search, maps_around_search}`，解析 `r.content` 得坐标/路线 → 调 `pushMapMarkers(...)` 注入到**当前 AI 气泡**对应的地图卡片（来源②，与抽取结果合并去重）。

新增文件清单：
- `src/lib/locationExtractor.js` —— 位置实体抽取
- `src/lib/amapJsApi.js` —— 高德 JS API 动态加载 + 地图/标记/路线封装（单例）
- `src/components/viz/MapCard.jsx` —— 内联地图卡片渲染
- `src/components/viz/MapPanel.jsx`（可选）—— 全局地图浮层
- `src/styles/cyber.css` —— `.map-card` / `.map-marker` / `.map-panel` 等赛博风样式
- `index.html` 可选静态占位 script（推荐改为运行时动态注入）

---

## 6. 边界与降级（不阻塞对话是红线）

- **抽取无位置** → 完全不渲染地图（静默）。
- **maps_geo 失败/超时** → 降级为「位置文本卡片」（仅显示地址 + 状态），对话照常。
- **JS API Key 缺失（占位）** → 瓦片加载失败 → 降级为「位置列表卡片」（地址 + GCJ-02 坐标文本，无瓦片），控制台提示需填 Key B；**绝不崩溃**。
- **隐私**：坐标仅本地渲染，不额外上报任何第三方。
- **性能**：单条消息最多 3 标记；卡片 IntersectionObserver 懒加载；JS API script 仅加载一次。

---

## 7. 合规红线（已用合规守卫核对）

- 渲染瓦片源仅限高德（白名单：高德 / 腾讯 / 百度 / 天地图）；禁用 Google Maps、OpenStreetMap、Mapbox、Leaflet+OSM 等。
- 国界、台湾、南海诸岛按国家标准绘制；不标未公开敏感坐标。
- Key B 用占位符 + Referer 白名单，绝不在前端硬编码可用 key。

---

## 8. 与现有 AMAP-MCP-DESIGN.md Phase 2 的关系

- 原 Phase 2 = 「手动地图浮层」。本功能是 **Phase 2 的自动触发演进版 / 超集**：把「手动开面板」升级为「对话位置自动内联标注」，并新增文本抽取触发源。
- 建议：本功能**取代**独立手动浮层，改为「内联卡片（主）+ 可选全局汇总浮层（增强）」。

---

## 9. 验收标准

1. 用户输入「我在杭州西湖区，明天去上海外滩看夜景」→ 对话框内出现地图卡片，标注**西湖、外滩**两点（GCJ-02 直绘无偏移）。
2. AI 回复「北京南站到首都机场可乘机场线，约 40 分钟」→ 若模型调了 transit 工具，地图标注两站 + 路线 polyline；否则抽取「北京南站」「首都机场」两标记。
3. 输入「你好」/「今天心情不错」→ **不触发**地图（无位置实体）。
4. 未配置 JS API Key B 时 → 降级为位置文本卡片，**不崩溃**。
5. `/api/mcp/status` 仍 `amap: connected`，真实 `maps_geo` 调用正常（已在 Phase 1 验证）。

---

## 10. 实施步骤（若后续执行）

1. **S1 抽取**：写 `locationExtractor.js`（正则+词典+置信过滤+去重）。
2. **S2 渲染基础**：`amapJsApi.js` 动态加载 JS API 单例 + `MapCard.jsx` + cyber.css 样式；`index.html`/动态注入占位 script。
3. **S3 接线用户消息**：`useChatController` L687 后接 `maybeShowMap(raw,"user")`。
4. **S4 接线 AI 消息**：L803 / L851 后接 `maybeShowMap(...,"ai")`；`executeTool` 内解析 maps_* 返回喂地图（来源②）。
5. **S5 降级与合规**：补齐 Key 缺失/超时降级卡片 + Referer 白名单说明；`npm run build` 验证；浏览器实测第 9 节用例。
6. **S6（可选）全局浮层**：`MapPanel.jsx` 汇总视图 + 内联卡片点击放大。

---

## 11. 实施记录（2026-08-17）

### 已落地文件
- `src/lib/locationExtractor.js` —— 位置实体抽取（正则+词典+置信过滤+子串去重，保留前 3 候选）。
- `src/lib/mapParse.js` —— `parseGeoMarker`（maps_geo 返回 → 标记）、`parseRoute`（方向工具返回 → 起终点标记；当前高德 MCP 方向工具**不返回 polyline**，故仅标起终点，polyline 分支保留供未来工具）。
- `src/lib/amapJsApi.js` —— 高德 JS API 2.0 动态加载单例 + 地图/标记/路线封装（GCJ-02 直绘，dark 样式）。
- `src/components/viz/MapCard.jsx` —— `createMapCardElement(markers, route, role)`，命令式 DOM，IntersectionObserver 懒加载；无 Key B 降级为坐标文本卡片。
- `src/hooks/useChatController.js` —— 接线：L687 用户输入、L803 AI 终态、L851 AI 错误各接 `maybeShowMap(...).catch(()=>{})`；`executeTool` 内 `maps_geo` / `maps_direction_*` 返回直接喂当前气泡地图卡片（来源②）；同消息坐标去重（WeakMap）。
- `src/styles/cyber.css` —— `.map-card*` 赛博风样式。
- `tests/autoMap.test.mjs` —— 16 项单测（抽取+真实 maps_geo/maps_direction 解析+降级），全部 PASS。
- `.env` —— 新增 `VITE_AMAP_JS_KEY` 占位注释（Key B，启用真实瓦片用）。

### 验证结果
- `npm run build` 通过（exit 0）。
- 单测 16/16 PASS，含**真实 Relay 返回**（maps_geo 杭州 → 120.13,30.25；transit 北京南站→首都机场 → 起终点标记）。

### 关键事实修正（实测发现）
- 高德 MCP 方向类工具（`maps_direction_transit_integrated`/`walking`/`driving`）返回均**不含 polyline**，只有 `route.origin`/`route.destination` 坐标。故路线 polyline 绘制暂不可行，退化为「起终点标记」；代码保留 polyline 分支，待工具支持。

### 运行须知（合规降级）
- 未配置 `VITE_AMAP_JS_KEY` 时，对话位置标注**降级为坐标文本卡片**（不崩、不硬编码 key）。配置后在 `.env` 填 Key B 并在高德控制台配 Referer 白名单即可加载真实瓦片。
- 浏览器实测：运行 `npm run dev`，发含地址消息（如「我在杭州市西湖区，明天去上海外滩」）应见内联地图卡片/坐标卡片。
