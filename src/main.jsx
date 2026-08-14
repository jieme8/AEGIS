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

// 不使用 StrictMode：原页面逻辑为单次初始化（rAF 循环 / 事件绑定 / 聊天初始化），
// StrictMode 的双调用会重复启动动画循环并重复绑定监听，破坏行为一致性。
createRoot(document.getElementById("root")).render(<App />);
