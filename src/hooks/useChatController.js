import { useEffect, useState } from "react";
import { MODEL_CONFIG } from "../config/modelConfig.js";
import { parseSSEChunk } from "../lib/sse.js";
import { isDevMode, onDevModeChange } from "../lib/devMode.js";
import { MCPClient } from "../lib/mcpClient.js";
import { ToolCallAccumulator } from "../lib/toolCalls.js";
import { runAgentLoop } from "../lib/agentLoop.js";

/**
 * 主对话窗口控制器（集成于频谱可视化器）—— 页面核心交互区。
 * 逻辑与原 chat 脚本 1:1 移植：居中前景主窗口，音频可视化退为背景氛围层。
 * 回复走真实大模型（LongCat）流式输出；接口不可用（网络/密钥/限流）时自动回退本地模拟。
 *
 * 过程可视化：通过 React 状态 trace / traceOpen 暴露「当前对话请求的完整流水线」
 * （请求状态 → 附加上下文 → 实际提示词 → 流式回复），由 ChatTraceDrawer 浮层消费。
 * 浮层在对话发起瞬间自动弹出（setTraceOpen(true)），无需按钮触发。
 */
// 复制文本到剪贴板，并在按钮上给出「已复制」瞬时反馈（不依赖全局 toast）
function copyText(text, btn) {
  const done = () => {
    if (btn) {
      btn.textContent = "已复制";
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = "复制"; btn.classList.remove("copied"); }, 1200);
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, done);
  } else {
    // 回退：临时 textarea + execCommand
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) { /* 忽略 */ }
    done();
  }
}

// 给消息气泡挂一个「复制」按钮（目前仅 AI 回复；如需用户消息也可放开）
function attachCopyButton(wrap, bubble) {
  const copyBtn = document.createElement("button");
  copyBtn.className = "chat-copy";
  copyBtn.type = "button";
  copyBtn.textContent = "复制";
  copyBtn.setAttribute("aria-label", "复制回复");
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    copyText(bubble.textContent, copyBtn);
  });
  wrap.appendChild(copyBtn);
}

export function useChatController() {
  // —— 过程可视化状态（最小侵入：仅这一份 React 状态，抽屉是唯一消费者）——
  const [trace, setTrace] = useState(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);   // 面板开合由 React 状态驱动，避免重渲染把 className 写回导致关闭失效
  const closeTrace = () => setTraceOpen(false);
  const toggleTrace = () => setTraceOpen((v) => !v);   // 一键显示/隐藏 5 个对话流浮层

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
    const clearBtn = document.getElementById("clearChat");
    const messagesEl = document.getElementById("chatMessages");
    const form = document.getElementById("chatComposer");
    const input = document.getElementById("chatInput");
    const sendBtn = document.getElementById("chatSend");

    const state = { history: [], busy: false };

    // ============ MCP 工具调用（Agent 能力 · 第一期 fetch，详见 MCP-INTEGRATION-PLAN.md） ============
    // 浏览器不直接连接 MCP 服务器（无法 spawn stdio / 持有凭据），而是经同源 /api/mcp
    // 代理到 Node 侧 MCP Relay。下面只持有客户端与缓存，编排逻辑在 handleSend 内。
    const mcpClient = new MCPClient(MODEL_CONFIG.mcpRelay);
    let cachedOpenAITools = null;   // OpenAI function 格式（带缓存，避免每轮请求）
    let cachedToolsFlat = null;     // 扁平 MCP tools（带 server 字段，用于 trace 展示）

    // 拉取并缓存可用工具；失败或空结果不缓存，便于 Relay 恢复后下次重试
    async function getTools() {
      if (!MODEL_CONFIG.toolsEnabled || !MODEL_CONFIG.supportsTools) return [];
      if (cachedOpenAITools) return cachedOpenAITools;
      try {
        const flat = await mcpClient.listTools();
        if (Array.isArray(flat) && flat.length) {
          cachedToolsFlat = flat;
          cachedOpenAITools = MCPClient.toOpenAITools(flat);
          return cachedOpenAITools;
        }
        return [];
      } catch (e) {
        console.warn("[mcp] 拉取工具失败，本轮降级为无工具对话：", (e && e.message) || e);
        return [];
      }
    }

    // 把工具调用事件同步进 trace（供 ChatTraceDrawer「06 工具调用」段渲染）
    function traceToolEvents(ev) {
      setTrace((prev) => {
        if (!prev || !prev.mcp) return prev;
        const mcp = { ...prev.mcp, invocations: prev.mcp.invocations ? [...prev.mcp.invocations] : [] };
        if (ev.type === "assistant_toolcalls") {
          mcp.status = "running";
        } else if (ev.type === "tool") {
          const inv = ev.invocation;
          const server = cachedToolsFlat
            ? (cachedToolsFlat.find((t) => t.name === inv.name) || {}).server || ""
            : "";
          mcp.invocations.push({ ...inv, server });
        } else if (ev.type === "final") {
          if (mcp.status === "running") mcp.status = "ok";
        } else if (ev.type === "error") {
          mcp.status = "error";
        }
        return { ...prev, mcp };
      });
    }

    // ============ 可拖拽 / 可缩放 / 布局持久化（DialogController） ============
    const LS_LAYOUT = "cyber-chat-layout-v2";
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
      // 默认绝对坐标：左上角 (1280, 16)，宽 510 高 700
      return { x: 1280, y: 16, w: 510, h: 700 };
    }

    // --- 拖拽（DragController）---
    let drag = null;
    function onDragStart(e) {
      if (!panel) return;
      if (e.target.closest(".chat-close, .chat-clear, .chat-trace, .dev-label")) return;  // 关闭/清空/对话流按钮与 ID 标签不触发拖拽
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

    // 桌面端：拖拽/缩放仅在 dev-mode（显示组件ID）时启用，退出即锁定
    function enablePanelDrag() {
      if (!panel || isTouchDevice()) return;
      if (dragHandle) {
        dragHandle.removeEventListener("pointerdown", onDragStart);
        dragHandle.addEventListener("pointerdown", onDragStart);
      }
      resizeHandles.forEach(function (h) {
        h.removeEventListener("pointerdown", onResizeStart);
        h.addEventListener("pointerdown", onResizeStart);
      });
      panel.classList.add("draggable");
    }
    function disablePanelDrag() {
      if (dragHandle) dragHandle.removeEventListener("pointerdown", onDragStart);
      resizeHandles.forEach(function (h) { h.removeEventListener("pointerdown", onResizeStart); });
      panel.classList.remove("draggable");
    }
    function syncPanelDragMode() {
      if (isDevMode()) enablePanelDrag(); else disablePanelDrag();
    }

    function bindLayoutEvents() {
      if (!panel) return;
      if (isTouchDevice()) {
        // 移动端降级：清除内联尺寸，回归居中静态布局，隐藏手柄
        panel.style.left = panel.style.top = panel.style.width = panel.style.height = "";
        panel.classList.add("static");
        return;
      }
      // 桌面端：依据 dev-mode 决定可否拖动，并订阅切换事件动态同步
      syncPanelDragMode();
      onDevModeChange(syncPanelDragMode);
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
      if (role === "ai") attachCopyButton(wrap, bubble);   // 回复内容一键复制
      messagesEl.appendChild(wrap);

      state.history.push({ role, text, time: ts });
      scrollBottom();
    }

    // 流式气泡：先建空气泡，后续逐块填充；textContent 防 XSS
    function createStreamingBubble() {
      const wrap = document.createElement("div");
      wrap.className = "chat-msg ai chat-streaming";
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = "AI · " + fmtTime(Date.now());
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = "";
      wrap.appendChild(who);
      wrap.appendChild(bubble);
      attachCopyButton(wrap, bubble);            // 流式回复同样支持复制
      messagesEl.appendChild(wrap);
      scrollBottom();
      return {
        set: (t) => { bubble.textContent = t; scrollBottom(); },
        finalize: (t) => { bubble.textContent = t; wrap.classList.remove("chat-streaming"); scrollBottom(); },
      };
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

    // ---------- 构造请求消息（system + 最近 12 轮历史） ----------
    // 注意：chat-panel 并非频谱数据智能体，故 system 提示词不含任何实时音频/
    // 频谱描述，仅保留通用 AI 助手身份与语气约束。
    function buildMessages() {
      const systemMsg = {
        role: "system",
        content:
          "你是集成在一个赛博朋克风格界面中的 AI 助手「J.A.R.V.I.S.」。" +
          "请用简体中文回答，语气带科技感，简洁清晰、切中要点。",
      };
      const historyMsgs = state.history.slice(-12).map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      }));
      const messages = [systemMsg, ...historyMsgs];
      return { systemMsg, historyMsgs, messages };
    }

    // ---------- 真实大模型流式调用（LongCat · OpenAI 兼容 SSE） ----------
    async function streamLongCat(messages, tools, handlers) {
      const onContent = handlers && handlers.onContent;
      const onReasoning = handlers && handlers.onReasoning;
      const onToolCallDelta = handlers && handlers.onToolCallDelta;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), MODEL_CONFIG.timeoutMs);
      try {
        // 仅生产/直连路径由浏览器携带鉴权；dev 经同源代理，代理已注入密钥
        const headers = { "Content-Type": "application/json" };
        if (MODEL_CONFIG.sendAuthFromBrowser) {
          headers["Authorization"] = "Bearer " + MODEL_CONFIG.apiKey;
        }
        const res = await fetch(MODEL_CONFIG.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: MODEL_CONFIG.model,
            messages,
            max_tokens: MODEL_CONFIG.maxTokens,
            temperature: MODEL_CONFIG.temperature,
            stream: true,
            // 仅在确有可用工具时附带 tools；否则走普通对话（降级/无工具场景）
            ...(tools && tools.length ? { tools } : {}),
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          let detail = "";
          try { const j = await res.json(); detail = (j && j.error && j.error.message) || JSON.stringify(j); } catch (e) { /* ignore */ }
          throw new Error("HTTP " + res.status + (detail ? " · " + detail : ""));
        }
        if (!res.body || !res.body.getReader) {
          throw new Error("当前环境不支持流式读取（无 ReadableStream）");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let carry = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const parsed = parseSSEChunk(chunk, carry);
          carry = parsed.carry;
          for (const ev of parsed.events) {
            let json;
            try { json = JSON.parse(ev); } catch (e) { continue; }
            const choice = json.choices && json.choices[0];
            if (!choice) continue;
            const delta = choice.delta || {};
            if (delta.content) onContent && onContent(String(delta.content));
            if (delta.reasoning_content) onReasoning && onReasoning(String(delta.reasoning_content));
            // tool_calls 流式碎片：逐片交给累加器重组（重组结果在请求结束时汇总）
            if (delta.tool_calls) onToolCallDelta && onToolCallDelta(delta.tool_calls);
          }
          if (parsed.done) break;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    function setBusy(b) {
      state.busy = b;
      sendBtn.disabled = b || input.value.trim() === "";
      if (clearBtn) clearBtn.disabled = b || state.history.length === 0;
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

      const typing = showTyping();            // 首个 token 到达前显示思考点

      // ---- 构造请求上下文 + 初始 trace（对话发起瞬间） ----
      const built = buildMessages();
      const traceInit = {
        status: "sending",
        sentAt: Date.now(),
        model: MODEL_CONFIG.model,
        mode: "longcat",
        context: {
          history: built.historyMsgs,
        },
        prompt: {
          system: built.systemMsg.content,
          messages: built.messages,
        },
        reply: { text: "", reasoning: "", done: false },
        // MCP 工具调用区：enabled 表示开关打开；status 随 tool-loop 演进
        mcp: {
          enabled: MODEL_CONFIG.toolsEnabled && MODEL_CONFIG.supportsTools,
          status: "pending",   // pending | running | ok | unavailable | error
          toolsCount: 0,
          invocations: [],
        },
      };
      setTrace(traceInit);
      setTraceOpen(true);                     // 对话发起瞬间自动弹出浮层

      // ---- 流式渲染本地状态 ----
      let answer = "";
      let reasoning = "";
      let started = false;
      let bubble = null;
      let flushScheduled = false;

      function beginStream() {
        if (started) return;
        started = true;
        if (typing && typing.remove) typing.remove();
        bubble = createStreamingBubble();
        setTrace((prev) => (prev ? { ...prev, status: "streaming" } : prev));
      }
      function flushTrace() {
        flushScheduled = false;
        setTrace((prev) =>
          prev ? { ...prev, reply: { ...prev.reply, text: answer, reasoning } } : prev);
      }
      function scheduleTraceFlush() {
        if (flushScheduled) return;
        flushScheduled = true;
        requestAnimationFrame(flushTrace);
      }

      // —— MCP tool-loop 编排所需的两次回调（闭包捕获本轮 answer/bubble 等） ——
      // 单次 LLM 请求：流式合并 content / reasoning / tool_calls 后返回给 agentLoop。
      async function requestLLM(messages, tools) {
        answer = ""; reasoning = "";            // 每轮重置，避免跨轮累积
        const acc = new ToolCallAccumulator();
        let err = null;
        try {
          await streamLongCat(messages, tools, {
            onContent: (d) => { beginStream(); answer += d; if (bubble) bubble.set(answer); scheduleTraceFlush(); },
            onReasoning: (d) => { beginStream(); reasoning += d; scheduleTraceFlush(); },
            onToolCallDelta: (tc) => { acc.add(tc); beginStream(); scheduleTraceFlush(); },
          });
        } catch (e) {
          err = (e && e.message) ? e.message : "未知错误";
        }
        return { content: answer, reasoning, toolCalls: acc.toMessageToolCalls(), error: err };
      }

      // 执行单个 MCP 工具（经 Relay）；错误向上抛，由 agentLoop 兜底回填
      async function executeTool(name, args, callId) {
        const r = await mcpClient.callTool(name, args);
        return { content: r.content, isError: r.isError };
      }

      try {
        // —— Agent tool-loop：检测 tool_calls → 调工具 → 回填 → 再请求（≤N 次） ——
        const result = await runAgentLoop({
          messages: built.messages,
          getTools,
          requestLLM,
          executeTool,
          maxIterations: MODEL_CONFIG.maxToolIterations,
          onEvent: traceToolEvents,
        });

        if (result.llmFailed) {
          // LLM 请求失败：复用原兜底逻辑（与下方 catch 一致）
          throw new Error(result.llmError || "LLM 请求失败");
        }

        if (!started) beginStream();          // 极少见：无任何增量也需定稿
        if (bubble) bubble.finalize(result.finalContent);
        state.history.push({ role: "assistant", text: result.finalContent, time: Date.now() });
        saveHistory();
        setTrace((prev) => (prev ? {
          ...prev, status: "done",
          mode: result.degraded ? "longcat-no-mcp" : "longcat",
          reply: { ...prev.reply, text: result.finalContent, reasoning: result.finalReasoning, done: true },
          mcp: {
            ...prev.mcp,
            status: result.degraded ? "unavailable" : (prev.mcp?.status || "ok"),
            toolsCount: cachedOpenAITools?.length || 0,
          },
        } : prev));
        // 触发“内容输出”页面特效，并在爆发结束后回落到 idle
        if (window.CyberFx) {
          window.CyberFx.output();
          setTimeout(() => { if (window.CyberFx) window.CyberFx.idle(); }, OUTPUT_BURST_MS);
        }
      } catch (err) {
        if (typing && typing.remove) typing.remove();
        const reason = (err && err.message) ? err.message : "未知错误";
        // 显式报错，避免「静默回退本地模拟」让用户误以为已接真实模型
        console.error(
          "[chat] LongCat 接口调用失败，已回退本地模拟回复：" +
          reason + "\n（请检查网络 / 代理 / 密钥；可在 trace 浮层查看状态）"
        );
        let finalText;
        if (MODEL_CONFIG.fallbackToLocal) {
          // 接口失败回退：中性本地文案（不与频谱数据绑定）
          finalText = "（本地模拟回复）当前无法连接 AI 服务，请稍后再试。";
          setTrace((prev) => (prev ? {
            ...prev, status: "fallback", mode: "local", error: reason,
            reply: { ...prev.reply, text: finalText, reasoning, done: true },
            mcp: { ...prev.mcp, status: "error" },
          } : prev));
        } else {
          finalText = "响应失败：" + reason;
          setTrace((prev) => (prev ? {
            ...prev, status: "error", error: reason,
            reply: { ...prev.reply, text: finalText, reasoning, done: true },
            mcp: { ...prev.mcp, status: "error" },
          } : prev));
        }
        // 渲染最终文本到气泡（已流式则定稿，否则新建）
        if (bubble) bubble.finalize(finalText);
        else appendMessage("ai", finalText);
        if (window.CyberFx) window.CyberFx.idle();
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
      // 开合交由 React 状态（panelOpen）驱动 className / aria-hidden，
      // 不再手动操作 DOM class，避免组件重渲染时 JSX 的 className 把 open 写回。
      setPanelOpen(open);
      if (openBtn) {
        openBtn.textContent = open ? "▾ 收起对话" : "▸ AI 对话";
        openBtn.classList.toggle("active", open);
      }
    }
    function toggleChat() { setChat(!panel.classList.contains("open")); }

    // 清空上下文：重置内存历史 + 清空 DOM 消息 + 清除本地持久化；trace 一并复位
    function clearChat() {
      if (state.busy) return;
      if (state.history.length === 0 && messagesEl.childElementCount === 0) return;
      const ok = window.confirm("确定要清空当前对话上下文吗？此操作不可撤销。");
      if (!ok) return;
      state.history = [];
      messagesEl.innerHTML = "";
      try { localStorage.removeItem(CONFIG.storageKey); } catch (e) { /* 忽略 */ }
      setTrace(null);
      setTraceOpen(false);
      if (clearBtn) clearBtn.disabled = true;
      updateSend();
    }

    function bindChatEvents() {
      if (openBtn) {
        openBtn.addEventListener("click", toggleChat);
        openBtn.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleChat(); }
        });
      }
      closeBtn.addEventListener("click", () => setChat(false));
      if (clearBtn) clearBtn.addEventListener("click", clearChat);
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
      if (clearBtn) clearBtn.disabled = state.history.length === 0;
      setChat(true);            // 默认作为主对话窗口呈现
      // 不自动聚焦输入框，避免移动端加载即弹出键盘；用户点击输入框再聚焦
    }

    init();
  }, []);

  return { trace, traceOpen, closeTrace, toggleTrace, panelOpen };
}
