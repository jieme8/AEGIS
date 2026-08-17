// 多供应商（模型 / API 地址 / 密钥）运行时管理。
// 来源：src/config/modelConfig.js 的 PROFILES（来自 .env）。
// 仅做「手动切换」：用户点选激活哪个供应商，请求时整组（endpoint+apiKey+model）切换。
import { PROFILES } from "../config/modelConfig.js";

const LS_KEY = "cyber-active-profile-v1";
const SOON_MS = 3 * 24 * 60 * 60 * 1000; // 3 天内视为「即将过期」

function loadActive() {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v && PROFILES.some((p) => p.id === v)) return v;
  } catch (e) {
    /* 隐私模式可能不可用 */
  }
  // 默认优先选第一把未过期的供应商；若全部过期则退回第一个
  const valid = PROFILES.find((p) => !p.expiresAt || p.expiresAt > Date.now());
  return (valid || PROFILES[0] || { id: null }).id;
}

let activeId = loadActive();

export const providerManager = {
  // 列表（带状态）：active / idle / soon / expired
  list() {
    const now = Date.now();
    return PROFILES.map((p) => {
      let status = "idle";
      if (p.id === activeId) status = "active";
      else if (p.expiresAt && p.expiresAt <= now) status = "expired";
      else if (p.expiresAt && p.expiresAt - now < SOON_MS) status = "soon";
      return { ...p, status };
    });
  },

  getActive() {
    return PROFILES.find((p) => p.id === activeId) || PROFILES[0] || null;
  },

  switch(id) {
    if (PROFILES.some((p) => p.id === id)) {
      activeId = id;
      try {
        localStorage.setItem(LS_KEY, id);
      } catch (e) {
        /* 忽略 */
      }
      return true;
    }
    return false;
  },

  hasProfiles() {
    return PROFILES.length > 0;
  },
};
