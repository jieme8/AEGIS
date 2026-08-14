import { useEffect } from "react";
import { DEV_NAMES } from "../data/devNames.js";

/**
 * 组件 ID 标注：为每个带 data-dev-id 的组件生成标签，并提供显隐开关 +
 * 悬停识别 + 点击复制 + 组件清单。
 * 逻辑与原 dev 脚本 1:1 移植。
 */
export function useDevOverlay() {
  useEffect(() => {
    "use strict";

    const body = document.body;
    const readout = document.getElementById("devReadout");
    const toast = document.getElementById("devToast");
    let toastTimer = null;

    // ---- 复制 + 提示（提前定义，供标签点击回调引用）----
    function flashCopied(node) {
      if (!node) return;
      node.classList.add("copied");
      setTimeout(() => node.classList.remove("copied"), 600);
    }
    function showToast(id) {
      if (!toast) return;
      toast.textContent = "已复制 ✓ " + id;
      toast.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 1300);
    }
    function copyText(text, node) {
      const done = () => { showToast(text); flashCopied(node); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, node));
      } else {
        fallbackCopy(text, node);
      }
    }
    function fallbackCopy(text, node) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.pointerEvents = "none";
        document.body.appendChild(ta); ta.focus(); ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) { showToast(text); flashCopied(node); } else showToast(text);
      } catch (err) {
        showToast(text);
      }
    }

    // ---- 标签生成（供初始扫描 + MutationObserver 动态补标共用）----
    const labeled = new Set();                              // 避免重复挂标
    function attachLabel(el) {
      if (labeled.has(el)) return;
      if (el.hasAttribute("data-dev-nolabel")) return;      // 背景全屏层不挂画布标签
      labeled.add(el);
      const id = el.getAttribute("data-dev-id");
      const tag = document.createElement("span");
      tag.className = "dev-label";
      tag.dataset.copyId = id;
      const idEl = document.createElement("span");
      idEl.className = "dl-id";
      idEl.textContent = id;
      const coordEl = document.createElement("span");
      coordEl.className = "dl-coord";
      coordEl.textContent = "";
      const sizeEl = document.createElement("span");
      sizeEl.className = "dl-size";
      sizeEl.textContent = "";
      tag.appendChild(idEl);
      tag.appendChild(coordEl);
      tag.appendChild(sizeEl);
      el.appendChild(tag);
      // 动态补标的标签也要能点击复制
      tag.addEventListener("click", (e) => {
        e.stopPropagation();
        copyText(tag.dataset.copyId || tag.textContent, tag);
      });
    }

    // 初始全量打标
    document.querySelectorAll("[data-dev-id]").forEach(attachLabel);

    // 监听动态新增的 data-dev-id 元素（Portal / 条件渲染 / 延迟挂载）
    const mo = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;                 // 跳过文本节点
          // 自身就是目标
          if (node.hasAttribute && node.hasAttribute("data-dev-id")) {
            attachLabel(node);
          }
          // 子节点里也有可能
          (node.querySelectorAll ? node.querySelectorAll("[data-dev-id]") : []).forEach(attachLabel);
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // 编辑模式下，为【所有】带标签的组件实时显示坐标（X/Y）与尺寸（W×H）
    let coordTimer = null;
    function updateCoordLabels() {
      document.querySelectorAll(".dev-label").forEach((tag) => {
        const coordEl = tag.querySelector(".dl-coord");
        const sizeEl = tag.querySelector(".dl-size");
        if (!coordEl || !sizeEl) return;
        const host = tag.parentElement;
        if (!host) return;
        const r = host.getBoundingClientRect();
        const x = Math.round(r.left);
        const y = Math.round(r.top);
        coordEl.textContent = `X:${x} Y:${y}`;
        sizeEl.textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
      });
    }
    function startCoordTimer() {
      if (coordTimer) return;
      updateCoordLabels();
      coordTimer = setInterval(updateCoordLabels, 120);
    }
    function stopCoordTimer() {
      if (coordTimer) { clearInterval(coordTimer); coordTimer = null; }
      // 关闭编辑模式时清空坐标与尺寸，避免残留
      document.querySelectorAll(".dev-label .dl-coord").forEach((c) => { c.textContent = ""; });
      document.querySelectorAll(".dev-label .dl-size").forEach((s) => { s.textContent = ""; });
    }

    // 悬停 / 选中：亮色描边 + 底部读数告知当前项
    function clearHover() {
      document.querySelectorAll(".dev-hover").forEach((x) => x.classList.remove("dev-hover"));
    }
    function setReadout(id) {
      const name = DEV_NAMES[id] || "";
      if (readout) {
        readout.innerHTML = "当前选中 ▸ <b>" + id + "</b>" + (name ? " · " + name : "");
      }
    }
    function showHover(el) {
      clearHover();
      el.classList.add("dev-hover");
      setReadout(el.getAttribute("data-dev-id"));
    }
    function outlineById(id) {
      clearHover();
      const sel = '[data-dev-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]';
      const el = document.querySelector(sel);
      if (el) el.classList.add("dev-hover");
      setReadout(id);
    }

    document.addEventListener("mouseover", (e) => {
      if (!body.classList.contains("dev-mode")) return;
      const el = e.target.closest && e.target.closest("[data-dev-id]");
      if (el) showHover(el);
    });
    document.addEventListener("mouseout", (e) => {
      if (!body.classList.contains("dev-mode")) return;
      const to = e.relatedTarget;
      // 离开组件且未进入另一个组件时，清除高亮（读数保留最后一项方便指代）
      if (!to || !(to.closest && to.closest("[data-dev-id]"))) clearHover();
    });

    // 画布标签点击复制（初始标签；动态补标的点击已在 attachLabel 内绑定）
    document.querySelectorAll(".dev-label").forEach((tag) => {
      tag.addEventListener("click", (e) => {
        e.stopPropagation();
        copyText(tag.dataset.copyId || tag.textContent, tag);
      });
    });

    // 组件清单（声明式渲染于 DevLegend.jsx）：用事件委托绑定悬停识别 + 点击复制
    const legend = document.getElementById("devLegend");
    const legendBody = document.getElementById("devLegendBody");
    if (legendBody) {
      legendBody.addEventListener("mouseover", (e) => {
        const row = e.target.closest && e.target.closest(".dev-legend-row");
        if (row && row.dataset.legendId) outlineById(row.dataset.legendId);
      });
      legendBody.addEventListener("click", (e) => {
        const row = e.target.closest && e.target.closest(".dev-legend-row");
        if (row && row.dataset.legendId) {
          e.stopPropagation();
          copyText(row.dataset.legendId, row);
        }
      });
    }
    // 清单折叠已移除：header 现在用于拖拽，点击不再触发折叠（避免「一点就缩小」）

    // 显隐开关
    const toggle = document.getElementById("devToggle");
    function setDevMode(on) {
      body.classList.toggle("dev-mode", on);
      if (toggle) {
        toggle.classList.toggle("active", on);
        toggle.textContent = on ? "隐藏组件ID" : "显示组件ID";
      }
      if (readout) {
        readout.textContent = on ? "悬停任意组件 → 查看 ID ｜ 点击 ID / 清单行 → 复制" : "";
      }
      if (on) startCoordTimer(); else { stopCoordTimer(); clearHover(); }
      if (toast) toast.classList.remove("show");
      // 广播模式切换，供拖拽等模块按 dev-mode 启用/停用
      window.dispatchEvent(new CustomEvent("devmodechange", { detail: { on } }));
    }
    if (toggle) {
      toggle.addEventListener("click", () => setDevMode(!body.classList.contains("dev-mode")));
    }
  }, []);
}
