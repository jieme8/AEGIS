import { useEffect } from "react";
import { DEV_NAMES, DEV_GROUPS } from "../data/devNames.js";

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

    // 生成标签（data-dev-nolabel 的组件只进清单、不出画布标签，避免顶部堆叠）
    const elements = document.querySelectorAll("[data-dev-id]");
    elements.forEach((el) => {
      if (el.hasAttribute("data-dev-nolabel")) return;   // 背景全屏层不挂画布标签
      const id = el.getAttribute("data-dev-id");
      const tag = document.createElement("span");
      tag.className = "dev-label";
      tag.dataset.copyId = id;                            // 复制永远用纯 ID（不受坐标后缀影响）
      // 结构化标签：ID 与实时坐标分两段，便于对齐与单独更新
      const idEl = document.createElement("span");
      idEl.className = "dl-id";
      idEl.textContent = id;
      const coordEl = document.createElement("span");
      coordEl.className = "dl-coord";
      coordEl.textContent = "";                           // 坐标在编辑模式开启后实时填充
      tag.appendChild(idEl);
      tag.appendChild(coordEl);
      el.appendChild(tag);
    });

    // 编辑模式下，为【所有】带标签的组件实时显示坐标（X/Y；可缩放的对话窗口附带 W×H）
    const SHOW_SIZE_IDS = ["chat-panel"];
    let coordTimer = null;
    function updateCoordLabels() {
      document.querySelectorAll(".dev-label").forEach((tag) => {
        const coordEl = tag.querySelector(".dl-coord");
        if (!coordEl) return;
        const host = tag.parentElement;
        if (!host) return;
        const r = host.getBoundingClientRect();
        const x = Math.round(r.left);
        const y = Math.round(r.top);
        let coord = `X:${x} Y:${y}`;
        if (SHOW_SIZE_IDS.indexOf(tag.dataset.copyId) !== -1) {
          coord += `  ${Math.round(r.width)}×${Math.round(r.height)}`;
        }
        coordEl.textContent = coord;
      });
    }
    function startCoordTimer() {
      if (coordTimer) return;
      updateCoordLabels();
      coordTimer = setInterval(updateCoordLabels, 120);
    }
    function stopCoordTimer() {
      if (coordTimer) { clearInterval(coordTimer); coordTimer = null; }
      // 关闭编辑模式时清空坐标，避免残留
      document.querySelectorAll(".dev-label .dl-coord").forEach((c) => { c.textContent = ""; });
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

    // 复制 + 提示
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

    // 画布标签点击复制（使用纯 ID，忽略坐标后缀）
    document.querySelectorAll(".dev-label").forEach((tag) => {
      tag.addEventListener("click", (e) => {
        e.stopPropagation();
        copyText(tag.dataset.copyId || tag.textContent, tag);
      });
    });

    // 组件清单（含背景特效）：逐行悬停识别 + 点击复制
    const legend = document.getElementById("devLegend");
    const legendBody = document.getElementById("devLegendBody");
    const legendCnt = document.getElementById("devLegendCnt");
    if (legendBody) {
      let total = 0;
      DEV_GROUPS.forEach((g) => {
        const gh = document.createElement("div");
        gh.className = "dev-legend-group";
        gh.textContent = g.title;
        legendBody.appendChild(gh);
        g.ids.forEach((id) => {
          total++;
          const row = document.createElement("div");
          row.className = "dev-legend-row";
          row.innerHTML = '<span class="rid">' + id + '</span><span class="rnm">' + (DEV_NAMES[id] || "") + '</span>';
          row.addEventListener("mouseenter", () => outlineById(id));
          row.addEventListener("click", (e) => { e.stopPropagation(); copyText(id, row); });
          legendBody.appendChild(row);
        });
      });
      if (legendCnt) legendCnt.textContent = total + " 项";
    }
    // 清单折叠
    const legendHead = document.getElementById("devLegendHead");
    if (legendHead && legend) {
      legendHead.addEventListener("click", () => legend.classList.toggle("collapsed"));
    }

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
    }
    if (toggle) {
      toggle.addEventListener("click", () => setDevMode(!body.classList.contains("dev-mode")));
    }
  }, []);
}
