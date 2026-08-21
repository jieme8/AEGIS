import React from "react";
import { createRoot } from "react-dom/client";
// 共享引擎（UMD）：导入即把 api 挂载到 window.SpectrumEngine，
// 保证原页面三方契约 window.SpectrumEngine / window.CyberFx / window.SpectrumAPI 完全一致。
import "./lib/spectrum-engine.js";
import "./styles/cyber.css";
// 自托管等宽字体（跨平台字形一致、hinting 优，改善 Windows 锐度）；先于 cyber.css 注册 @font-face
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles/typography-crisp.css"; // 字体清晰度专项优化（非破坏式，可整体移除）
import App from "./App.jsx";

// 平台标记：仅当运行在 Windows / Mac+Chrome 时给 <html> 打 data-os / mac-chrome 类。
// - data-os="win"  → typography-crisp.css 启用「中文→微软雅黑」回退
// - mac-chrome     → cyber.css 关闭 chat-panel/面板类的 backdrop-filter（Mac 上 backdrop 重绘代价高）
//                   特别是思考动画期间，三个 tdot 持续 opacity/transform 变化，
//                   backdrop-filter 会让浏览器反复重绘整层，体感卡顿。
// 非 Windows / 非 Mac Chrome 不落标记，零影响。
(function setOsClass() {
  try {
    const ua = navigator.userAgent || "";
    const uaPlatform = (navigator.userAgentData && navigator.userAgentData.platform) || "";
    const isWin = /Win/i.test(ua) || /Win/i.test(uaPlatform);
    if (isWin) document.documentElement.setAttribute("data-os", "win");
    // Mac Chrome：Safari 不要走这条（Safari backdrop 性能不弱，且要走 macOS 原生毛玻璃观感）
    const isMac = /Mac/i.test(uaPlatform) || (/Mac/i.test(ua) && !/iPhone|iPad/i.test(ua));
    const isChrome = /Chrome|CriOS/i.test(ua) && !/Edg|OPR|Firefox/i.test(ua);
    if (isMac && isChrome) document.documentElement.classList.add("mac-chrome");
  } catch (e) {
    /* 环境不支持时静默跳过 */
  }
})();

// 不使用 StrictMode：原页面逻辑为单次初始化（rAF 循环 / 事件绑定 / 聊天初始化），
// StrictMode 的双调用会重复启动动画循环并重复绑定监听，破坏行为一致性。
createRoot(document.getElementById("root")).render(<App />);
