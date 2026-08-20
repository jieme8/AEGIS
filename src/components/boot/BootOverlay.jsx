// =========================================================
// 启动遮罩（BOOT）：故障 LOGO + 旋转环 + 终端日志打字 + 进度条。
// 纯展示层，不侵入业务组件；时序由 props.active 触发退场，
// 进度/日志时长取自 src/lib/bootTimeline.js 的 BOOT_MS / BOOT_LOG。
// =========================================================
import { useEffect, useRef, useState } from "react";
import { BOOT_MS, BOOT_LOG } from "../../lib/bootTimeline.js";

export function BootOverlay({ active, onFinish, onSkip }) {
  const ref = useRef(null);
  const [lines, setLines] = useState([]);

  // 进度条填充 + 逐行日志（终端打字感）
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.setProperty("--boot-ms", BOOT_MS + "ms");
      requestAnimationFrame(() => el.classList.add("boot-go")); // 触发进度条过渡
    }
    let i = 0;
    const push = () => {
      if (i >= BOOT_LOG.length) return;
      setLines((prev) => [...prev, BOOT_LOG[i++]]);
      setTimeout(push, BOOT_MS / (BOOT_LOG.length + 1));
    };
    push();
  }, []);

  // active=false → 退场（淡出 + 轻微放大），结束后通知父级卸载
  useEffect(() => {
    if (!active) return undefined;
    const el = ref.current;
    if (el) el.classList.add("done");
    const t = setTimeout(onFinish, 900);
    return () => clearTimeout(t);
  }, [active, onFinish]);

  return (
    <div
      className="boot"
      ref={ref}
      onClick={onSkip}
      role="presentation"
    >
      <div className="boot-core">
        <div className="glitch" data-text="J.A.R.V.I.S.">J.A.R.V.I.S.</div>
        <div className="boot-sub">JUST A RATHER VERY INTELLIGENT SYSTEM</div>

        <div className="boot-ring" />

        <div className="boot-log">
          {lines.map((l, idx) => (
            <div className="ln" key={idx}>
              <span className={l.ok ? "ok" : "warn"}>[{l.ok ? " OK " : " .. "}]</span>{" "}
              {l.t}
            </div>
          ))}
          {lines.length < BOOT_LOG.length && <span className="caret" />}
        </div>

        <div className="progress"><i /></div>
        <div className="hint">点击任意处跳过 / CLICK TO SKIP</div>
      </div>
    </div>
  );
}
