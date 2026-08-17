// 多供应商切换器（常显，置于顶部右侧）。
// 手动切换当前激活供应商（整组 endpoint + apiKey + model 一起切）；
// 带 expired / soon 状态提示，便于在密钥过期前优先消耗。
// 交互形态：下拉框（<select>），避免多 chip 占用横向空间。
import { useState } from "react";
import { providerManager } from "../../lib/providerManager.js";

export function ProviderSwitcher() {
  const [activeId, setActiveId] = useState(providerManager.getActive()?.id || null);

  if (!providerManager.hasProfiles()) return null;

  const onPick = (e) => {
    const id = e.target.value;
    if (providerManager.switch(id)) setActiveId(id);
  };

  const items = providerManager.list();

  return (
    <div className="provider-switch" id="providerSwitch" data-dev-id="fx-provider-switch">
      <span className="ps-label">API</span>
      <select
        className="provider-select"
        value={activeId || ""}
        onChange={onPick}
        title="切换模型供应商（整组 endpoint + 密钥 + 模型）"
      >
        {items.map((p) => (
          <option
            key={p.id}
            value={p.id}
            className={
              "provider-opt" +
              (p.status === "expired" ? " expired" : "") +
              (p.status === "soon" ? " soon" : "")
            }
          >
            {p.label}
            {p.status === "expired"
              ? " · 过期"
              : p.status === "soon"
                ? " · 将过期"
                : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
