import { useEffect } from "react";
import { MODEL_CONFIG } from "../config/modelConfig.js";

/**
 * 主对话窗口控制器（集成于频谱可视化器）—— 页面核心交互区。
 * 逻辑与原 chat 脚本 1:1 移植：居中前景主窗口，音频可视化退为背景氛围层。
 * 回复默认走真实大模型（LongCat）；接口不可用（网络/密钥/限流）时自动回退本地模拟。
 */
export function useChatController() {
  useEffect(() => {
    "use strict";

    const CONFIG = {
      typingMinMs: 500,
      typingMaxMs: 1300,
      maxChars: 2000,
      storageKey: "cyber-chat-history-v1",
    };
    const OUTPUT_BURST_MS = 900;            // 与 viz 脚本 OUTPUT_BURST(0.9s) 对应

    const panel = document.getElementById("chatPanel");
    const openBtn = document.getElementById("openChat");
    const closeBtn = document.getElementById("closeChat");
    const messagesEl = document.getElementById("chatMessages");
    const form = document.getElementById("chatComposer");
    const input = document.getElementById("chatInput");
    const sendBtn = document.getElementById("chatSend");

    const state = { history: [], busy: false };

    // ============ 可拖拽 / 可缩放 / 布局持久化（DialogController） ============
    const LS_LAYOUT = "cyber-chat-layout-v1";
    const MIN_W = 320, MIN_H = 240;
    const dragHandle = document.getElementById("chatDragHandle");
    const resizeHandles = panel ? panel.querySelectorAll(".resize-handle") : [];

    // --- 边界约束 ---
    function clampRect(r) {
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = Math.max(MIN_W, Math.min(r.w || panel.offsetWidth, vw - 16));
      const h = Math.max(MIN_H, Math.min(r.h || panel.offsetHeight, vh - 16));
      const x = Math.max(0, Math.min(r.x || panel.offsetLeft, vw - w));
      const y = Math.max(0, Math.min(r.y || panel.offsetTop, vh - h));
      return { x, y, w, h };
    }
    function applyRect(r) {
      if (!panel) return;
      const c = clampRect(r);
      panel.style.left = c.x + "px";
      panel.style.top = c.y + "px";
      panel.style.width = c.w + "px";
      panel.style.height = c.h + "px";
    }
    function getRect() {
      if (!panel) return { x: 0, y: 0, w: 620, h: 480 };
      const r = panel.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }

    // --- 持久化（LayoutPersistence） ---
    function saveLayout() {
      try { localStorage.setItem(LS_LAYOUT, JSON.stringify(getRect())); } catch (e) { /* 忽略 */ }
    }
    function loadLayout() {
      try {
        const raw = localStorage.getItem(LS_LAYOUT);
        if (raw) { const o = JSON.parse(raw); if (o && typeof o.x === "number") return o; }
      } catch (e) { /* 忽略 */ }
      return null;
    }
    function defaultRect() {
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = Math.min(540, vw * 0.42);              // 右侧栏宽度略窄
      return { x: vw - w - 20, y: 58, w, h: vh - 58 - 96 }; // 靠右对齐（距右边缘 20px）
    }

    // --- 拖拽（DragController）---
    let drag = null;
    function onDragStart(e) {
      if (!panel) return;
      if (e.target.closest(".chat-close")) return;           // 关闭按钮不触发拖拽
      if (e.button !== undefined && e.button !== 0) return;   // 仅左键
      drag = { px: e.clientX, py: e.clientY, rect: getRect() };
      panel.classList.add("dragging");
      dragHandle.setPointerCapture(e.pointerId);
      window.addEventListener("pointermove", onDragMove);
      window.addEventListener("pointerup", onDragEnd, { once: true });
      e.preventDefault();
    }
    function onDragMove(e) {
      if (!drag || !panel) return;
      applyRect({
        x: drag.rect.x + (e.clientX - drag.px),
        y: drag.rect.y + (e.clientY - drag.py),
        w: drag.rect.w, h: drag.rect.h,
      });
    }
    function onDragEnd() {
      drag = null;
      if (panel) panel.classList.remove("dragging");
      window.removeEventListener("pointermove", onDragMove);
      saveLayout();
    }

    // --- 缩放（ResizeController）---
    let rz = null;
    function onResizeStart(e) {
      if (!panel) return;
      rz = { px: e.clientX, py: e.clientY, rect: getRect(),
        dir: e.currentTarget.getAttribute("data-dir") };
      panel.classList.add("resizing");
      e.currentTarget.setPointerCapture(e.pointerId);
      window.addEventListener("pointermove", onResizeMove);
      window.addEventListener("pointerup", onResizeEnd, { once: true });
      e.preventDefault(); e.stopPropagation();
    }
    function onResizeMove(e) {
      if (!rz || !panel) return;
      const dx = e.clientX - rz.px, dy = e.clientY - rz.py;
      let { x, y, w, h } = rz.rect;
      const d = rz.dir;
      if (d.includes("e")) w = rz.rect.w + dx;
      if (d.includes("s")) h = rz.rect.h + dy;
      if (d.includes("w")) { w = rz.rect.w - dx; x = rz.rect.x + dx; }
      if (d.includes("n")) { h = rz.rect.h - dy; y = rz.rect.y + dy; }
      applyRect({ x, y, w, h });
    }
    function onResizeEnd() {
      rz = null;
      if (panel) panel.classList.remove("resizing");
      window.removeEventListener("pointermove", onResizeMove);
      saveLayout();
    }

    // --- 初始化几何 + 绑定事件（含移动端降级）---
    function isTouchDevice() {
      return window.matchMedia("(hover: none) and (pointer: coarse)").matches
        || window.innerWidth <= 640;
    }
    function initLayout() {
      applyRect(loadLayout() || defaultRect());
    }
    function bindLayoutEvents() {
      if (!panel || isTouchDevice()) {
        // 移动端降级：清除内联尺寸，回归居中静态布局，隐藏手柄
        if (panel) {
          panel.style.left = panel.style.top = panel.style.width = panel.style.height = "";
          panel.classList.add("static");
        }
        return;
      }
      if (dragHandle) dragHandle.addEventListener("pointerdown", onDragStart);
      resizeHandles.forEach(function (h) { h.addEventListener("pointerdown", onResizeStart); });
      // 视口变化时重新约束面板位置/尺寸，防止越界
      window.addEventListener("resize", function () { applyRect(getRect()); saveLayout(); });
    }

    const fmtTime = (ts) =>
      new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

    // localStorage 容错（隐私模式可能不可用）
    function loadHistory() {
      try {
        const raw = localStorage.getItem(CONFIG.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) state.history = parsed;
        }
      } catch (e) { /* 忽略 */ }
    }
    function saveHistory() {
      try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(state.history)); }
      catch (e) { /* 忽略 */ }
    }

    function scrollBottom() {
      requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
    }

    function appendMessage(role, text, time) {
      const ts = time || Date.now();
      const wrap = document.createElement("div");
      wrap.className = "chat-msg " + role;

      const who = document.createElement("div");
      who.className = "who";
      who.textContent = (role === "user" ? "YOU · " : "AI · ") + fmtTime(ts);

      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = text;                 // textContent 防 XSS

      wrap.appendChild(who);
      wrap.appendChild(bubble);
      messagesEl.appendChild(wrap);

      state.history.push({ role, text, time: ts });
      scrollBottom();
    }

    function showTyping() {
      if (window.CyberFx) window.CyberFx.thinking();   // 进入“思考中”页面特效
      const wrap = document.createElement("div");
      wrap.className = "chat-msg ai chat-typing";
      wrap.innerHTML =
        '<div class="who">AI</div>' +
        '<div class="bubble"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span></div>';
      messagesEl.appendChild(wrap);
      scrollBottom();
      return wrap;
    }

    // ---------- 实时频谱快照 → 文本（供 system 上下文使用） ----------
    function readSnapshot() {
      return (window.SpectrumAPI && window.SpectrumAPI.snapshot)
        ? window.SpectrumAPI.snapshot() : null;
    }
    function formatLiveData(snap) {
      const pct = (v) => Math.round((v || 0) * 100);
      if (!snap) return "（当前暂无实时频谱数据）";
      const band = snap.dominantRatio < 0.34 ? "低频"
        : (snap.dominantRatio < 0.67 ? "中频" : "高频");
      return "当前实时频谱数据：整体能量 " + pct(snap.energy) + "%，峰值 " +
        pct(snap.peak) + "%，低/中/高频均值 " + pct(snap.lowAvg) + "% / " +
        pct(snap.midAvg) + "% / " + pct(snap.highAvg) + "%，当前能量主要集中在" +
        band + "段。";
    }

    // ---------- 真实大模型调用（LongCat · OpenAI 兼容） ----------
    async function callLongCat(messages) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), MODEL_CONFIG.timeoutMs);
      try {
        const res = await fetch(MODEL_CONFIG.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + MODEL_CONFIG.apiKey,
          },
          body: JSON.stringify({
            model: MODEL_CONFIG.model,
            messages,
            max_tokens: MODEL_CONFIG.maxTokens,
            temperature: MODEL_CONFIG.temperature,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          let detail = "";
          try { const j = await res.json(); detail = (j && j.error && j.error.message) || JSON.stringify(j); } catch (e) { /* ignore */ }
          throw new Error("HTTP " + res.status + (detail ? " · " + detail : ""));
        }
        const data = await res.json();
        const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error("接口返回缺少内容字段");
        return String(content).trim();
      } finally {
        clearTimeout(timer);
      }
    }

    // ---------- AI 回复：真实模型优先，失败回退本地模拟 ----------
    async function getAIResponse(text) {
      const snap = readSnapshot();
      const liveData = formatLiveData(snap);

      const systemMsg = {
        role: "system",
        content:
          "你是集成在一个赛博朋克风格音频频谱可视化器中的 AI 助手，名为 J.A.R.V.I.S.。" +
          "你能读取该可视化器的实时音频频谱数据；当用户询问能量、频段、波形、峰值等实时信息时，请基于下方实时数据作答，" +
          "其他问题正常简洁回答。使用简体中文，语气带科技感。\n\n" + liveData,
      };

      // 历史上下文（state.history 末尾已包含本次用户消息，无需重复追加）
      const historyMsgs = state.history.slice(-12).map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      }));
      const messages = [systemMsg, ...historyMsgs];

      try {
        return await callLongCat(messages);
      } catch (err) {
        if (MODEL_CONFIG.fallbackToLocal) {
          console.warn("[chat] 真实 AI 接口调用失败，已回退本地模拟回复：", err && err.message ? err.message : err);
          return window.SpectrumEngine.buildSpectrumReply(snap, text);
        }
        throw err;
      }
    }

    function setBusy(b) {
      state.busy = b;
      sendBtn.disabled = b || input.value.trim() === "";
      input.disabled = b;
    }

    async function handleSend() {
      const raw = input.value.trim();
      if (!raw || state.busy) return;
      if (raw.length > CONFIG.maxChars) {
        appendMessage("ai", "消息过长，请控制在 " + CONFIG.maxChars + " 字以内。");
        return;
      }
      appendMessage("user", raw);
      input.value = "";
      autoGrow();
      updateSend();
      setBusy(true);

      const typing = showTyping();
      try {
        const reply = await getAIResponse(raw);
        typing.remove();
        appendMessage("ai", reply);
        saveHistory();
        // 触发“内容输出”页面特效，并在爆发结束后回落到 idle
        if (window.CyberFx) {
          window.CyberFx.output();
          setTimeout(() => { if (window.CyberFx) window.CyberFx.idle(); }, OUTPUT_BURST_MS);
        }
      } catch (err) {
        typing.remove();
        if (window.CyberFx) window.CyberFx.idle();
        appendMessage("ai", "响应失败：" + (err && err.message ? err.message : "未知错误"));
      } finally {
        setBusy(false);
        input.focus();
      }
    }

    function autoGrow() {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 160) + "px";  // 与 CSS max-height:160px 同步
    }
    function updateSend() {
      if (!state.busy) sendBtn.disabled = input.value.trim() === "";
    }

    function setChat(open) {
      panel.classList.toggle("open", open);
      panel.setAttribute("aria-hidden", open ? "false" : "true");
      if (openBtn) {
        openBtn.textContent = open ? "▾ 收起对话" : "▸ AI 对话";
        openBtn.classList.toggle("active", open);
      }
    }
    function toggleChat() { setChat(!panel.classList.contains("open")); }

    function bindChatEvents() {
      if (openBtn) {
        openBtn.addEventListener("click", toggleChat);
        openBtn.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleChat(); }
        });
      }
      closeBtn.addEventListener("click", () => setChat(false));
      form.addEventListener("submit", (e) => { e.preventDefault(); handleSend(); });
      input.addEventListener("input", () => { autoGrow(); updateSend(); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          handleSend();
        }
      });
    }

    function init() {
      initLayout();            // 先恢复/设定几何（必须在 setChat 前）
      bindLayoutEvents();      // 绑定拖拽/缩放或移动端降级
      loadHistory();
      const snapshot = state.history;
      state.history = [];
      for (const item of snapshot) appendMessage(item.role, item.text, item.time);
      bindChatEvents();
      updateSend();
      setChat(true);            // 默认作为主对话窗口呈现
      // 不自动聚焦输入框，避免移动端加载即弹出键盘；用户点击输入框再聚焦
    }

    init();
  }, []);
}
