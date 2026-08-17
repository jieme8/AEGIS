// 多生图供应商运行时管理（前端侧，仅展示 + 选择，绝不持有密钥）。
// 与语言模型的 providerManager.js 同源范式，但刻意「不含 apiKey/endpoint」——
// 生图密钥只存在于服务端 image-proxy.mjs，前端只把选中的供应商 id 随请求发过去。
// 来源：src/config/imageConfig.js 的 IMAGE_PROFILES（公开标签，无敏感信息）。
import { IMAGE_PROFILES, IMAGE_DEFAULT_PROVIDER } from "../config/imageConfig.js";

const LS_KEY = "cyber-active-image-provider-v1";

function loadActive() {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v && IMAGE_PROFILES.some((p) => p.id === v)) return v;
  } catch (e) {
    /* 隐私模式可能不可用 */
  }
  return IMAGE_DEFAULT_PROVIDER;
}

let activeId = loadActive();

export const imageProviderManager = {
  // 列表（带 active 状态），供下拉框渲染
  list() {
    return IMAGE_PROFILES.map((p) => ({
      ...p,
      status: p.id === activeId ? "active" : "idle",
    }));
  },

  getActive() {
    return IMAGE_PROFILES.find((p) => p.id === activeId) || IMAGE_PROFILES[0] || null;
  },

  switch(id) {
    if (IMAGE_PROFILES.some((p) => p.id === id)) {
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
    return IMAGE_PROFILES.length > 0;
  },
};
