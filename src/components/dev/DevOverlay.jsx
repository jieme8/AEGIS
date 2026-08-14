import { Fragment, useRef, useState } from "react";
import { DEV_NAMES, DEV_GROUPS } from "../../data/devNames.js";
import { useDevOverlay } from "../../hooks/useDevOverlay.js";

// 调试覆盖层（组件 ID 标注 / 清单 / 复制），仅在编辑模式可见。

// 组件清单：直接从 DEV_GROUPS / DEV_NAMES 声明式渲染，
// 改数据文件后 HMR 即时生效，避免「一次性 effect 不重跑导致清单陈旧」。
// 支持拖拽（标题栏按住拖动，dev-mode 下可用）。
export function DevLegend() {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e) => {
    // 只在 dev-mode 下允许拖拽，且不拦截行点击/折叠
    if (!document.body.classList.contains("dev-mode")) return;
    const box = ref.current;
    if (!box) return;
    const startX = e.clientX, startY = e.clientY;
    const origLeft = box.offsetLeft, origTop = box.offsetTop;
    box.style.bottom = "auto";   // 解除 bottom 锚定
    setDragging(true);
    box.style.userSelect = "none";
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      const maxL = Math.max(0, window.innerWidth - box.offsetWidth);
      const maxT = Math.max(0, window.innerHeight - box.offsetHeight);
      box.style.left = Math.max(0, Math.min(origLeft + dx, maxL)) + "px";
      box.style.top = Math.max(0, Math.min(origTop + dy, maxT)) + "px";
    };
    const onUp = () => {
      setDragging(false);
      box.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    e.preventDefault();
  };

  const total = DEV_GROUPS.reduce((n, g) => n + g.ids.length, 0);
  return (
    <div
      ref={ref}
      className={"dev-legend" + (dragging ? " dragging" : "")}
      id="devLegend"
      data-dev-id="dev-legend"
    >
      <div className="dev-legend-head" id="devLegendHead" onPointerDown={onPointerDown}>
        <span>组件清单 · MAP</span>
        <span className="cnt" id="devLegendCnt">{total} 项</span>
      </div>
      <div className="dev-legend-body" id="devLegendBody">
        {DEV_GROUPS.map((g) => (
          <Fragment key={g.title}>
            <div className="dev-legend-group">{g.title}</div>
            {g.ids.map((id) => (
              <div className="dev-legend-row" key={id} data-legend-id={id}>
                <span className="rid">{id}</span>
                <span className="rnm">{DEV_NAMES[id] || ""}</span>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function DevOverlay() {
  useDevOverlay();
  return (
    <>
      <button className="dev-toggle" id="devToggle" type="button" title="显示 / 隐藏页面组件的参考 ID">
        显示组件ID
      </button>
      <div className="dev-readout" id="devReadout" />
      <div className="dev-toast" id="devToast" />
      <DevLegend />
    </>
  );
}
