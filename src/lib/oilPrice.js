// =========================================================
// useOilPrice — 油价卡实时数据 hook
//
// 浏览器只请求同源的 /api/oil（由 Vite 代理到 Node 侧 oilApi.mjs 抓取「油价网」），
// 拉到真实 92# 汽油零售价。零售价约每 10 个工作日调一次，故 5 分钟轮询足够；
// 切回前台时立即刷新。抓取失败 / 初次加载时回退到占位值，保证面板不空、不崩。
//
// 返回：
//   { data, forecast, nextAdjust, prevAdjust, updatedAt, live, loading, error }
//   live=true 表示当前展示的是真实抓取数据；false 表示占位兜底。
// =========================================================
import { useEffect, useRef, useState } from "react";

const POLL_MS = 5 * 60 * 1000; // 5 分钟

// 兜底占位（与旧硬编码一致），抓取失败/初次加载时用，保证面板不空。
const FALLBACK = {
  data: { name: "92# 汽油", unit: "元/升", price: 7.79, prevClose: 7.98 },
  forecast: { direction: "down", text: "预计小幅下调" },
  nextAdjust: null,
  prevAdjust: null,
};

export function useOilPrice() {
  const [state, setState] = useState({
    data: FALLBACK.data,
    forecast: FALLBACK.forecast,
    nextAdjust: null,
    prevAdjust: null,
    updatedAt: null,
    live: false,
    loading: true,
    error: null,
  });
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch("/api/oil", { cache: "no-store" });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
        setState({
          data: j.data,
          forecast: j.forecast,
          nextAdjust: j.nextAdjust,
          prevAdjust: j.prevAdjust,
          updatedAt: j.fetchedAt,
          live: true,
          loading: false,
          error: null,
        });
      } catch (e) {
        if (!alive) return;
        // 保留上一次成功数据（若有），否则维持兜底占位；live 状态不变
        setState((s) => ({ ...s, loading: false, error: e.message || String(e) }));
      }
    };

    load();
    timer.current = setInterval(load, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return state;
}
