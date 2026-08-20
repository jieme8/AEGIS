import { useDevOverlay } from "../../hooks/useDevOverlay.js";

// 调试覆盖层（组件 ID 标注 / 复制），仅在编辑模式可见。

export function DevOverlay() {
  useDevOverlay();
  return (
    <>
      <div className="dev-readout" id="devReadout" />
      <div className="dev-toast" id="devToast" />
    </>
  );
}
