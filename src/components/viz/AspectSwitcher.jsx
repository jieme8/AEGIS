// 生图比例切换器（常显于顶部，与 IMG 生图模型切换并列）。
// 复用 .provider-switch / .provider-select 同款样式，仅标签为 RATIO 区分。
// 自管理：value 来自 aspectManager.getActive()，切换写 localStorage，管线生成时读取。
// 刻意放在顶部（不在可拖拽的 image-window 内）——避免窗口标题栏的拖拽 pointerdown 拦截 select 点击。
import { useState } from "react";
import { aspectManager } from "../../lib/aspectManager.js";

export function AspectSwitcher() {
  const [activeId, setActiveId] = useState(aspectManager.getActive() || null);

  if (!aspectManager.hasOptions()) return null;

  const onPick = (e) => {
    const id = e.target.value;
    if (aspectManager.switch(id)) setActiveId(id);
  };

  const items = aspectManager.list();

  return (
    <div className="provider-switch" id="aspectSwitch" data-dev-id="fx-aspect-switch">
      <span className="ps-label">RATIO</span>
      <select
        className="provider-select"
        value={activeId || ""}
        onChange={onPick}
        title="切换生图比例（横版海报 / 宽屏 / 竖版 等）"
      >
        {items.map((p) => (
          <option key={p.id} value={p.id} className="provider-opt">
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
