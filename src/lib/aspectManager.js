// 生图比例选择器（与 imageProviderManager 同范式，但只管“比例”，绝不含密钥/模型信息）。
// 选中比例随请求发到 /api/genimg，由服务端按 provider 的 size/ratio 映射塑形：
//   Agnes  → toAgnesRatio()（支持 1:1,3:4,4:3,16:9,9:16,2:3,3:2,21:9）
//   SenseNova → toSize()（固定档位，21:9 对应 3072x1376，已是横向最大分辨率）
// 仅前端展示 + localStorage 记忆，无网络请求、无敏感信息。
export const ASPECT_OPTIONS = [
  { id: "21:9", label: "21:9 横版海报" },
  { id: "16:9", label: "16:9 宽屏" },
  { id: "3:2", label: "3:2 横版" },
  { id: "4:3", label: "4:3 横版" },
  { id: "1:1", label: "1:1 方形" },
  { id: "9:16", label: "9:16 竖版" },
  { id: "2:3", label: "2:3 竖版" },
  { id: "3:4", label: "3:4 竖版" },
];

// 默认激活比例：横版海报（21:9），本环境到生图服务较慢且横向能容纳更多信息条。
export const ASPECT_DEFAULT = "21:9";

const KEY = "cyber-active-aspect-v1";

function read() {
  try {
    const v = localStorage.getItem(KEY);
    if (v && ASPECT_OPTIONS.some((o) => o.id === v)) return v;
  } catch {
    /* localStorage 不可用时回退默认 */
  }
  return ASPECT_DEFAULT;
}

let active = read();

export const aspectManager = {
  list: () => ASPECT_OPTIONS,
  getActive: () => active,
  switch: (id) => {
    if (!ASPECT_OPTIONS.some((o) => o.id === id)) return false;
    active = id;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* 忽略写入失败 */
    }
    return true;
  },
  hasOptions: () => ASPECT_OPTIONS.length > 0,
};
