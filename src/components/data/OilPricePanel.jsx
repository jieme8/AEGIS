// =========================================================
// OilPricePanel — 横向长条单品种油价卡（赛博风）
//
// 特性：数字计数入场动效（仅加载时一次，不持续跳动）、涨跌幅
//       （中国习惯 涨=红 跌=绿）、下次调价倒计时、预估上调/下调。
//
// 用法：
//   import { OilPricePanel } from "./components/data/OilPricePanel.jsx";
//   <OilPricePanel
//     data={{ price, prevClose, unit, name, sub, updatedAt }}
//     nextAdjust={new Date("2026-08-14T24:00:00")}
//     forecast={{ direction: "down", text: "预计小幅下调" }}
//     basis="较上次调价 08-01"
//   />
//
// 说明：零售指导价由国家发改委每 ~10 个工作日调一次，平时为固定值，
//       故组件不做实时跳动；change 表示相对上次调价的涨跌。
// =========================================================
import { useEffect, useRef, useState } from "react";
import "./oil-price.css";
import { isDevMode, onDevModeChange } from "../../lib/devMode.js";

/* 数字计数入场动效（easeOutCubic）。
   修复：原本 from===to 导致首屏完全不播放。现改为从 0 生长到目标值，
   并由 gate（boot 完成）控制触发时机 —— 保证遮罩淡出后数字“从无到有”滚入。 */
function useCountUp(target, duration = 900, gate = true) {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);
  useEffect(() => {
    if (!gate) {
      setVal(0);
      fromRef.current = 0;
      return;
    }
    const from = fromRef.current;
    const to = target;
    if (from === to) {
      setVal(to);
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, gate]);
  return val;
}

function daysUntil(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

/* =========================================================
   成品油调价窗口（国家发改委：每 ~10 个工作日调一次，24:00 生效）。
   这里锚定官方公布的年度窗口表，避免用“每 10 天”瞎算导致节假日错位。
   新增年份时把对应数组补上即可；找不到当年表时退化为“每 10 天”估算。
   ========================================================= */
const OIL_ADJUST_SCHEDULE = {
  2026: [
    "01-06", "01-20", "02-03", "02-24", "03-09", "03-23", "04-07", "04-21",
    "05-08", "05-21", "06-04", "06-18", "07-03", "07-17", "07-31", "08-14",
    "08-28", "09-11", "09-24", "10-15", "10-29", "11-12", "11-26", "12-10",
    "12-24",
  ],
};

// 把 "MM-DD" 转成当年调价日当天的 Date（0 点）；24:00 仅用于倒计时文案
function mmddToWindowDate(yyyy, mmdd) {
  const [m, d] = mmdd.split("-").map(Number);
  return new Date(yyyy, m - 1, d, 0, 0, 0, 0);
}

// 给定今天，返回 { prev, next } 两个调价日 Date：
//   next = 第一个 ≥ 今天的窗口（含今日，今日即“今日调价”）；
//   prev = 最后一个 < 今天的窗口（已生效）。
// 当年表用尽时 next 为 null（界面显示“待官方公布”）。
function computeAdjustWindow(today) {
  const yyyy = today.getFullYear();
  const table = OIL_ADJUST_SCHEDULE[yyyy] || null;
  const base = new Date(yyyy, today.getMonth(), today.getDate());

  if (table) {
    let prev = null;
    let next = null;
    for (const mmdd of table) {
      const w = mmddToWindowDate(yyyy, mmdd);
      if (w < base) prev = w; // 已生效
      else {
        next = w; // 首个 ≥ 今天的窗口
        break;
      }
    }
    return { prev, next };
  }

  // 退化策略：无官方表时按约 10 天循环估算（仅兜底，不保证节假日准确）
  const approx = (offset) => {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const dayIdx = Math.floor((base - new Date(yyyy, 0, 1)) / 86400000) % 10;
  return { prev: approx(-dayIdx), next: approx(10 - dayIdx) };
}

// 实时时钟：每 intervalMs 刷新一次，驱动“更新于”与倒计时随系统时间变化
function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function fmtMMDD(date) {
  if (!date) return "—";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}
function fmtHM(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

export function OilPricePanel({
  data,
  nextAdjust, // 可选：外部强制指定下次窗口；缺省时按年度表从今天动态推算
  forecast, // { direction: "up" | "down" | "hold", text }
  basis,
  booted = false, // 启动序列完成后再触发数字计数入场
}) {
  const rootRef = useRef(null);
  const now = useNow(60000); // 每分钟刷新，保证“更新于”与倒计时跟随系统时间

  // 动态调价窗口：优先用外部 nextAdjust，否则按年度表推算
  const adjustWindow = nextAdjust
    ? { prev: null, next: nextAdjust }
    : computeAdjustWindow(now);

  // 仅在「显示组件ID」(dev-mode) 时允许拖动油价卡。拖动作用于外层 .oil-dock
  // （fixed 容器，避免受 dock 自身 transform 影响）；退出 dev-mode 时移除监听（位置保留）。
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const dock = el.closest(".oil-dock") || el;
    let drag = null;

    function onDown(e) {
      if (!isDevMode()) return;
      if (e.target.closest && e.target.closest(".dev-label")) return; // 点击 ID 标签不触发拖拽
      if (e.button !== undefined && e.button !== 0) return;
      const r = dock.getBoundingClientRect();
      dock.style.transform = "none";          // 解除居中 transform，改用 left/top 驱动
      dock.style.position = "fixed";
      dock.style.left = r.left + "px";
      dock.style.top = r.top + "px";
      dock.style.bottom = "auto";
      drag = { px: e.clientX, py: e.clientY, left: r.left, top: r.top };
      dock.classList.add("oil-dragging");
      try { dock.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
      e.preventDefault();
    }
    function onMove(e) {
      if (!drag) return;
      const w = dock.offsetWidth, h = dock.offsetHeight;
      const maxLeft = Math.max(0, window.innerWidth - w);
      const maxTop = Math.max(0, window.innerHeight - h);
      const left = Math.max(0, Math.min(drag.left + (e.clientX - drag.px), maxLeft));
      const top = Math.max(0, Math.min(drag.top + (e.clientY - drag.py), maxTop));
      dock.style.left = left + "px";
      dock.style.top = top + "px";
    }
    function onUp() {
      drag = null;
      dock.classList.remove("oil-dragging");
      window.removeEventListener("pointermove", onMove);
    }
    function applyMode(on) {
      if (on) {
        el.classList.add("oil-draggable");
        el.addEventListener("pointerdown", onDown);
      } else {
        el.classList.remove("oil-draggable");
        el.removeEventListener("pointerdown", onDown);
      }
    }
    const unsub = onDevModeChange(applyMode);
    return () => {
      unsub();
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  if (!data) return null;

  const { name, unit, price, prevClose } = data;
  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;
  const up = change >= 0;
  const anim = useCountUp(price, 900, booted);

  const nextDate = adjustWindow.next;
  const prevDate = adjustWindow.prev;
  const dCount = nextDate ? daysUntil(nextDate) : null;
  const dDay =
    nextDate &&
    `${String(nextDate.getMonth() + 1).padStart(2, "0")}-${String(
      nextDate.getDate()
    ).padStart(2, "0")} 24:00`;

  const fCls =
    forecast?.direction === "up"
      ? "up"
      : forecast?.direction === "down"
      ? "down"
      : "hold";
  const fArrow =
    forecast?.direction === "up" ? "▲" : forecast?.direction === "down" ? "▼" : "—";

  return (
    <div className="oil" data-dev-id="oil-price-panel" ref={rootRef}>
      <span className="oil-led" />
      <div className="oil-main">
        <div className="oil-name">{name}</div>
        <div className="oil-price">
          {anim.toFixed(2)}
          <span className="unit">{unit}</span>
        </div>
      </div>

      <div className={`oil-chg ${up ? "oil-chg-up" : "oil-chg-down"}`}>
        <span className="oil-arrow">{up ? "▲" : "▼"}</span>
        <span>{Math.abs(change).toFixed(2)}</span>
        <span className="oil-pct">({up ? "+" : "-"}{Math.abs(changePct).toFixed(2)}%)</span>
      </div>

      <div className="oil-sep" />

      <div className="oil-info">
        <div className="oil-row">
          <span className="oil-k">调价</span>
          <span className="oil-v">
            {dCount === null
              ? "待公布"
              : dCount <= 0
              ? "今日调价"
              : `剩 ${dCount} 天`}
            {dDay ? (
              <span className="oil-dim"> · {dDay}</span>
            ) : nextDate ? null : (
              <span className="oil-dim"> · 待官方公布</span>
            )}
            {prevDate && (
              <span className="oil-dim">（上次 {fmtMMDD(prevDate)}）</span>
            )}
          </span>
        </div>
        <div className="oil-row">
          <span className="oil-k">预估</span>
          <span className={`oil-v ${fCls}`}>
            {fArrow} {forecast?.text ?? "—"}
          </span>
        </div>
        <div className="oil-row">
          <span className="oil-k">更新</span>
          <span className="oil-v oil-dim">
            {fmtMMDD(now)} {fmtHM(now)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default OilPricePanel;
