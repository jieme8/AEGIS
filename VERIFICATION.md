# 重构自检报告 · Cyber Audio Spectrum（React 版）

> 目标：将单文件 `audio-visualizer.html` 重构为 Vite + React 18 组件化工程，**严格保持**原页面的全部功能逻辑、视觉样式、布局、交互与全局契约不变。
> 本文件记录“完成后自行测试”的自检结论。

## 验证结论

| 维度 | 结果 | 说明 |
| --- | --- | --- |
| 生产构建 | ✅ 通过 | `vite build` → 45 modules transformed，JS 171.78 kB / CSS 14.38 kB |
| 引擎逻辑（唯一非 UI 逻辑）| ✅ 10/10 断言通过 | `node scripts/verify-engine.cjs`：1000 帧模拟无 NaN/越界、快照结构、AI 回复分支、边界保护、工具函数 |
| 服务可达性 | ✅ HTTP 200 | `vite preview` 下 HTML / JS / CSS 均返回 200 |
| 全局契约 | ✅ 保留 | `window.SpectrumEngine` / `window.CyberFx` / `window.SpectrumAPI` 均出现在打包产物中 |
| DOM id 契约 | ✅ 完全一致 | 原 HTML 与 React 渲染的 `id` 集合逐条 diff 相同；所有 `getElementById` 依赖的 id 均被组件渲染 |
| dev 标记契约 | ✅ 一致 | `data-dev-id` / `data-form` 与原页面一致（HUD 四角经 `data-dev-id={id}` 动态渲染，运行期存在）|
| 样式契约 | ✅ 无缺失 | `cyber.css` 为原 `<style>` 逐字提取；组件使用的 37 个类名全部能在 CSS 中找到对应规则 |

## 工程结构（组件化拆分）

```
src/
  main.jsx                  # 入口：副作用导入引擎(挂载 window.SpectrumEngine) + 全局 CSS，无 StrictMode(避免 rAF/事件双重初始化)
  App.jsx                   # 按原 body 顺序组合所有组件，调用 useVizEngine()
  styles/cyber.css          # 原 <style> 逐字提取
  lib/spectrum-engine.js    # 共享引擎(UMD)：始终挂载 root.SpectrumEngine，Node 下同时 module.exports(供测试)
  data/devNames.js          # DEV_NAMES / DEV_GROUPS 常量
  hooks/
    useVizEngine.js         # 可视化引擎(画布渲染/形态切换/黑客流拖拽)，暴露 window.CyberFx / window.SpectrumAPI
    useChatController.js    # 对话逻辑(拖拽/缩放/localStorage/AI 回复)
    useDevOverlay.js        # 调试覆盖层(组件 id 标注/清单/复制/坐标/图例)
  components/
    background/Background.jsx
    viz/{SpectrumCanvas,TitleBar,FormSwitchButtons,HackerStreamZone,DevZones}.jsx
    hud/Hud.jsx
    chat/ChatPanel.jsx
    dev/DevOverlay.jsx
```

## 关键技术决策（保证行为一致）

1. **命令式逻辑 1:1 搬移**：三个 IIFE（viz/chat/dev）原样移植进三个自定义 Hook，未改写成 React 状态驱动的“新实现”，从根上避免行为漂移。
2. **DOM 契约保留**：Hook 内部仍按 `id` 查询 DOM（`document.getElementById`），组件渲染的 `id` / `class` / `data-*` 与原 HTML 完全一致；App 同步渲染、effect 后执行，时序与原页面相同。
3. **引擎 UMD 修复**：打包环境（ESM）下 `module` 未定义，原 UMD 仅在不满足 CJS 分支时跳过导出；改为**始终挂载 `root.SpectrumEngine`**，保证 `window.SpectrumEngine` 与 `window.CyberFx`/`window.SpectrumAPI` 在浏览器与测试环境均可访问（见 `src/lib/spectrum-engine.js`）。
4. **不使用 StrictMode**：避免开发期 rAF 渲染循环与事件绑定的双重初始化导致“双线/双绑”。
5. **CSS 逐字提取**：未做任何格式化改写，避免选择器差异。

## 复现自检命令

```bash
npm install
npm run build             # 生产构建
npm test                  # 引擎逻辑断言 (scripts/verify-engine.cjs)
npm run verify            # 引擎断言 + 类名覆盖检查 (clscheck.mjs)
npm run preview           # 启动预览，浏览器访问 http://localhost:4173/
```

## 测试环境说明（重要）

本环境**未安装任何浏览器二进制**（无 Chrome/Chromium/Playwright），因此无法执行真实浏览器内的交互级冒烟测试（画布动画、拖拽/缩放、对话发送、形态切换动画、dev 覆盖层悬停）。

对应保障策略：
- 代码为原页面脚本的**字节级忠实移植**（DOM id/class/data 属性/CSS/全局变量完全一致，已逐项静态校验）；
- 唯一的非 UI 逻辑（频谱引擎）已通过 Node 单元测试覆盖；
- 生产构建与服务可达性均已通过。

在具备浏览器的环境中执行 `npm run preview` 即可进行完整交互验证；如需要我也可补充一份 Playwright 冒烟用例（需先安装浏览器）。
