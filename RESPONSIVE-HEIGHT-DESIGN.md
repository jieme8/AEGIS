# 矮屏（短高度）响应式设计 —— 以 1374×421 为目标

> 配套：现有 `RESPONSIVE-LAYOUT.md`（宽度轴断点 1099/900/640/420）。
> 本文新增**高度轴断点**，与宽度轴**正交**，专门解决"宽但极矮"的横屏视口（如 1374×421）。
> 范围：`src/App.jsx` 渲染的全部浮于 canvas 之上的 HUD / 面板组件。
> 状态：**设计稿，未落地**。所有改动以本文为准，先不改代码。

---

## 0. 一句话结论

现有 8 套断点**全部只看宽度**，对高度为零感知。1374×421 的难点是**高度 421px 比多数手机还矮**，
所有组件的"固定高度"直接溢出版心、互相压盖。解决办法：**补一条高度轴断点**（看 `innerHeight`），
把界面从"四角岛屿"重构为 **上下条带 + 中部双栏** 的"横向 letterbox 模式"。

---

## 1. 现状诊断：1374×421 下到底哪里崩

1374 宽度 > 1100，落"大屏 XL"：CSS 的 `max-width` 规则**一条都不触发**，全部走桌面固定定位。
但高度只有 421，下面这些组件的固定几何全部超界：

| 组件 | 现有固定几何（桌面默认） | 在 421 高下的结果 |
|---|---|---|
| 对话窗 `.chat-panel` | JS `defaultRect()`：`x:1300, y:80, h:min(700,max(360,vh-154))` | `h=360`，`clampRect` 强制到底 → 底部 `y≈421` 与**任务栏右端重叠**（z11 盖住 z9 的右 2~3 个按钮） |
| MCP 浮层 `.mcp-panel` | `top:80, height:600`（**默认开启** `mcpOpen=true`） | 600 > 421，底部被**裁切**，下半部分完全无法操作 |
| 左下 HUD `.hud.bl` | `bottom:18`，约 5 行 ≈ 100px 高，x≠MCP | 被 **MCP 左栏（z60）整体盖住**，状态读数不可见 |
| 配图窗 `.image-window` | `top:80, h:418` | 418 > 421-? → 底部溢出 |
| 地图窗 `.map-window` | `'left:130, top:330'`（硬编码） | `top:330 + h:500 = 830` → **几乎整窗越界不可见** |
| 清单窗 `.feat-window` | `'left:980, top:80, h:460'` | 底部溢出 |
| 流程图窗 `.flow-window` | `'left:370, top:90, h:700'` | `max-height:100vh` 夹到 421，但 `top:90` → 底部 `510` 溢出 |
| 追踪浮层 ×6 `.float-panel` | 硬编码 `(330,80)/(970,80)/(330,310)/(640,360)/(970,340)/(330,310)` | `y≥310` 的浮层 + `max-height:80vh=337` → 底部溢出；**且 spawn 时不做钳制，只有拖动才钳** |
| 影视窗 `.msw-panel` | `left:790` 仅在 ≤1320 居中；>1320 走 `790` | `790+800=1590 > 1374` → 右侧溢出 |
| 调试清单 `.dev-legend`（dev） | `left:140, top:444` | `top:444 > 421` → **整个移出视口** |
| 标题 / 油价卡 / Provider | 顶部 fixed，高度较小 | 基本 OK，但油价卡（≈58px）与内容区顶缘贴太近，需收敛 |
| 任务栏 `.task-bar` | 底部居中 | 可见，但被右侧对话窗压住 |

**根因小结**：高度维度缺席 + 多个组件用硬编码 `top/height`（尤其是 `height:600` 的 MCP 和
`x/y` 写死的浮层）。宽度断点救不了，必须加高度轴。

---

## 2. 设计原则

1. **正交断点**：高度轴 `max-height` 与宽度轴 `max-width` 各自独立、可同时命中、互不覆盖；CSS 把高度规则放在宽度规则**之后**，对共有属性以高度规则为准。
2. **条带化（letterbox）**：矮屏不堆"四角岛屿"，而是 **顶部一行 + 中部工作区 + 底部一行**，纵向留 ≥8px 净空。
3. **尺寸有界流式**：所有高度用 `calc(100vh - 顶 - 底)` 而非写死像素；横向 `min()/max()` 夹取。
4. **JS 几何必须感知高度**：`defaultRect()`、各浮窗 spawn 坐标、FloatingPanel 挂载初始位置，全部按视口动态计算 + 挂载即钳制（不只拖动时钳）。
5. **大屏（≥1100 且 ≥561 高）零改动**，保证 1:1 还原。

---

## 3. 断点矩阵

| 高度 \ 宽度 | XL ≥1100 | LG ≤1099 | MD ≤900 | SM ≤640 |
|---|---|---|---|---|
| **正常 ≥561** | 并存 | 抽屉化 | 紧凑化 | 单窗降级 |
| **SH-1 ≤600** | 轻度压缩 | 抽屉+压缩 | 紧凑+压缩 | 单窗+压缩 |
| **SH-2 ≤480** | **条带模式 ★（1374×421）** | 抽屉条带 | 紧凑条带 | 单窗条带 |

- 1374×421 → **XL × SH-2** → 命中"条带模式"。
- 仅新增两档高度断点：`SH-1 @max-height:600px`、`SH-2 @max-height:480px`。
- 手机竖屏（如 390×844，高 >600）不受高度轴影响，沿用既有移动端逻辑（已验证）。

---

## 4. 1374×421 逐组件规格（条带模式，精确坐标）

纵向预算（421 高）：
- 顶部带 `y:0–64`（油价卡/标题/Provider 单行收敛；油价卡 ≈56px）
- 中部工作区 `y:72–373`（约 301px 可用）
- 底部带 `y:373–421`：HUD 单行状态条（`y:359–377`）+ 任务栏（`y:379–413`）

| 组件 | 条带模式几何 | 说明 |
|---|---|---|
| 油价卡 `.oil-dock` | `top:8 left:10`，内部紧凑（降 padding、price `clamp` 下限下调） | 横向长条不动 |
| 标题 `.title-wrap` | `top:8` 居中，glitch 字号 `16px` 字距 `3px`，**`.sub-title` 隐藏** | 单行 |
| Provider `.provider-switch` | `top:8 right:10`，`padding:5px 8px`，select `12px` | 紧凑 |
| 形态切换 `.form-switch`（dev） | `top:36` 水平居中、`h:34`、按钮 `12px`（原 `top:16 left:422`） | 让出顶部角位 |
| 对话窗 `.chat-panel` | **JS 高度感知**：`{ x: vw-w-12, y:72, w:min(500,vw*0.38), h:vh-72-48 }`；CSS fallback `top:72; height:calc(100vh-120px)` | 右栏停靠，底留 48 避开底部带；`MIN_H=240` 满足 |
| MCP 浮层 `.mcp-panel` | **左栏化**：`top:72 bottom:66 left:10 width:300`（高度 `auto` 撑满），`.mcp-body` `max-height:none` | 取代写死 `height:600`；满高约 283px 可用 |
| 配图窗 `.image-window` | `top:72, height:calc(100vh-120px)≈301`，`left` 保留 `640`（1374 下 `640+320=960` 不越界） | — |
| 地图窗 `.map-window` | spawn `left:322 top:72`，`height:calc(100vh-120px)` | 让开 MCP 左栏 |
| 清单窗 `.feat-window` | spawn `left:982`（1374 下 `982+340=1322<1374`）`top:72`、`height` 同上 | 或落在中部舞台区 |
| 流程图窗 `.flow-window` | 水平居中、`top:8, height:calc(100vh-16)`、`max-height:100vh` | 全宽大窗 |
| 追踪浮层 ×6 `.float-panel` | **挂载即钳制**进视口；`max-height:calc(100vh-120px)`；预设坐标改为视口相对（如列 `x≈322/650`，行 `y≈72`） | 关键修复 |
| 影视窗 `.msw-panel` | `left:max(12px, min(790px, 100vw-820px))` 或统一居中；`top:8, height:min(700,vh-16)` | 修 >1320 时的右侧溢出 |
| 左下 HUD `.hud.bl` | **改为底部单行状态条**：`left:10 bottom:46`（或并入顶部带右侧）；`FPS/ENERGY/PEAK/GAIN` 横排，`pointer-events:none` | 彻底避开 MCP 左栏遮挡 |
| 任务栏 `.task-bar` | `bottom:8`，`padding:5px 8px`，按钮 `padding:4px 9px` `font:11.5px`；保留 TASK 标签（宽度充裕） | — |
| 调试清单 `.dev-legend`（dev） | `right:8 top:72`（取代 `top:444`），限宽 | 防移出视口 |
| 黑客流区 `.hacker-drag-zone` | JS 默认 `{x:296,y:72}`；`y` 钳制 `vh-150` 已含，无需改 | 引擎绘制自动缩放 |
| 启动遮罩 `.boot-overlay` | ring `120→56`，log 行数/字号收敛，`max-height` 夹视口 | 防竖屏内容被裁 |
| 设置 modal / 各 lightbox | 已用 `vh`/`vw` 流式，421 高下 `max-height:86vh=362` 等自然可用，**无需改** | — |
| 背景/canvas/扫描线/扫描条 | `inset:0` 全视口，引擎按 client 尺寸自适应 | **无需改** |

### 4.1 高度轴与宽度轴的合成规则

- 高度规则写在宽度规则**之后**，对 `top/bottom/height/max-height` 等共有属性，矮屏规则优先。
- `SM(≤640)` 且同时命中 `SH-2` 时：移动端 `.static` 规则与条带规则都生效，需在条带块内补 `.chat-panel.static { top:64; bottom:44 }` 防止顶部带挤压。
- `isTouchDevice()`（JS，宽度 ≤640）不变；条带模式由**纯 CSS `max-height`** 驱动，与 JS 触摸判定解耦。

---

## 5. 需要改的 JS 点（设计，未实施）

| 文件 | 改动 |
|---|---|
| `src/hooks/useChatController.js` | `defaultRect()` 增加高度感知：矮屏返回右栏停靠几何（见 §4 对话窗行）。建议抽 `isShortViewport() = innerHeight <= 560`。 |
| `src/components/common/FloatingPanel.jsx` | `useEffect` 挂载时把 `defaultPos` 钳进视口（`maxL/maxT` 思路复用 `onMove` 里的逻辑），并给 `.float-body` 加 `max-height: calc(100vh - 120px)`。 |
| `src/components/viz/{ImageWindow,MapWindow,FeatureListWindow,FlowDiagramWindow}.jsx` | spawn 坐标改为视口相对（见 §4），`resize` 钳制已存在，仅需修初始坐标。 |
| `src/components/viz/{ImageWindow,MapWindow}.jsx` 的 `newH` 计算 | `Math.min(window.innerHeight - 100, ...)` 改为 `Math.min(window.innerHeight - 120, ...)` 统一留给底部带。 |
| `src/components/viz/McpPanel.jsx` | `.mcp-panel` 高度由 CSS 控制（SH-2 改成左栏 `auto`），JS 的 `maxTop` 钳制已存在，无需改。 |

---

## 6. CSS 新增节（放在 `RESPONSIVE-LAYOUT.md` 的响应式层之后）

```css
/* ============ 矮屏（短高度）布局层 ============ */
/* 与宽度断点正交：两轴可同时命中，高度规则写在后面优先 */

/* SH-1：轻度压缩 */
@media (max-height: 600px) {
  .title-wrap { top: 10px; }
  .title-wrap .glitch { font-size: 18px; letter-spacing: 4px; }
  .sub-title { display: none; }
  .oil-dock { top: 10px; }
  .provider-switch { top: 10px; }
  .hud.bl { bottom: 44px; }            /* 让出底部带 */
  .task-bar { bottom: 10px; }
}

/* SH-2：条带模式（1374×421 命中） */
@media (max-height: 480px) {
  .title-wrap { top: 8px; }
  .title-wrap .glitch { font-size: 16px; letter-spacing: 3px; }
  .sub-title { display: none; }
  .oil-dock { top: 8px; }
  .provider-switch { top: 8px; padding: 5px 8px; }
  .provider-select { font-size: 12px; }
  .form-switch { top: 36px; left: 50%; transform: translateX(-50%); height: 34px; }
  .form-switch .form-btn { font-size: 12px; }

  /* 对话窗：右栏停靠，底留底部带 */
  .chat-panel { top: 72px; height: calc(100vh - 120px); }

  /* MCP：左栏满高（取代 height:600） */
  .mcp-panel { top: 72px; bottom: 66px; left: 10px; width: 300px; height: auto; }
  .mcp-body { max-height: none; }

  /* 各浮窗：高度夹视口，顶留顶部带 */
  .image-window, .map-window, .feat-window,
  .flow-window, .msw-panel {
    top: 72px; height: calc(100vh - 120px);
  }
  .flow-window { top: 8px; height: calc(100vh - 16px); }
  .float-panel .float-body { max-height: calc(100vh - 120px); }

  /* 影视窗：防 >1320 右侧溢出 */
  .msw-panel { left: max(12px, min(790px, 100vw - 820px)); top: 8px; }

  /* HUD：左下 → 底部单行状态条 */
  .hud.bl { bottom: 46px; left: 10px; flex-direction: row; gap: 14px;
            padding: 3px 8px; font-size: 10px; pointer-events: none; }

  /* 任务栏：紧凑 */
  .task-bar { bottom: 8px; padding: 5px 8px; }
  .tb-btn { padding: 4px 9px; font-size: 11.5px; }

  /* 调试清单：移入视口右上（dev） */
  .dev-legend { right: 8px; top: 72px; left: auto; }
}

/* 手机竖屏(≤640) 同时矮屏：static 顶部带收紧 */
@media (max-width: 640px) and (max-height: 480px) {
  .chat-panel.static { top: 64px; bottom: 44px; }
}
```

> 以上为示意，落地时需与现有 `.mcp-panel` / `.chat-panel` / `.hud.bl` 等原始规则核对，
> 确保高度轴规则追加在宽度规则**之后**（同特异性下后者覆盖前者）。

---

## 7. 验证方法

1. `npm run dev`，DevTools 设备工具栏切 **1374×421**：
   - 顶部一行（油价/标题/Provider）、中部双栏（MCP 左栏 / 可视化舞台 / 对话窗右栏）、底部单行状态条 + 任务栏，无重叠。
   - MCP 左栏满高、底部按钮可达；HUD 状态条可见且不被遮挡。
   - 依次点开 地图/清单/流程图/配图窗，确认 spawn 在视口内、可拖动、可关闭。
2. 切回 **1920×1080**：确认大屏 1:1 还原，高度轴规则**完全不触发**（视觉无变化，`git diff` 仅新增媒体查询块）。
3. 切 **390×844**（手机竖屏）：确认既有移动端逻辑不受影响。
4. 切 **740×360**（手机横屏，SM×SH-2）：确认 `.static` + 条带合成正常。
5. console 无布局报错；拖动对话窗后在 1374×421 刷新，确认被钳回视口内。

---

## 8. 改动总清单（实施时）

| 文件 | 改动 |
|---|---|
| `src/styles/cyber.css` | 新增"矮屏布局层"（`@media max-height:600/480`，SH-1/SH-2 两档，见 §6） |
| `src/hooks/useChatController.js` | `defaultRect()` 高度感知（右栏停靠几何） |
| `src/components/common/FloatingPanel.jsx` | 挂载即钳制进视口 + `max-height` 夹取 |
| Image/Map/Feature/Flow 四窗 | spawn 坐标改视口相对、底部留白 120 |
| `src/components/viz/McpPanel.jsx` | 高度改由 CSS 控制（左栏），JS 钳制已具备 |

> 桌面（≥1100 且 ≥561 高）视觉与交互零改动。
