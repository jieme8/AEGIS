// 生图供应商切换器（常显于顶部，与语言模型的 fx-provider-switch 并列）。
// 和 ProviderSwitcher 同形态、同款样式（复用 .provider-switch / .provider-select，仅标签为 IMG 区分）。
// 自管理：value 来自 imageProviderManager.getActive()，切换写 localStorage，请求时随 body 发到服务端。
// 刻意放在顶部（不在可拖拽的 image-window 内）——避免窗口标题栏的拖拽 pointerdown 拦截 select 点击。
import { useState } from "react";
import { imageProviderManager } from "../../lib/imageProviderManager.js";

export function ImageProviderSwitcher() {
  const [activeId, setActiveId] = useState(imageProviderManager.getActive()?.id || null);

  if (!imageProviderManager.hasProfiles()) return null;

  const onPick = (e) => {
    const id = e.target.value;
    if (imageProviderManager.switch(id)) setActiveId(id);
  };

  const items = imageProviderManager.list();

  return (
    <div className="provider-switch" id="imageProviderSwitch" data-dev-id="fx-image-provider-switch">
      <span className="ps-label">IMG</span>
      <select
        className="provider-select"
        value={activeId || ""}
        onChange={onPick}
        title="切换生图模型（Agnes / SenseNova 等）"
      >
        {items.map((p) => (
          <option key={p.id} value={p.id} className={"provider-opt" + (p.status === "active" ? " active" : "")}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
