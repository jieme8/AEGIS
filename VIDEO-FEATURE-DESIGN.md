# 配视频功能技术方案（精简版）

> 参照现有「配图」功能同构实现：旁路事件桥 + 独立窗口 + 配置总开关（`enabled=false` 默认关闭，零影响）。
> 核心区别：配图是「AI 终态自动生图」，配视频是「**用户主动发送 + 展示播放**」→ 主模式定为**附件上传**，AI 文生视频作为可关的扩展第二模式。

---

## 1. 主流程（附件上传模式，覆盖"发送+展示"）

```
输入区点 📎 视频 → 选本地文件 → videoClient.attach(file)
  → 校验(MIME/大小/时长) → videoStore 存 IndexedDB → videoPoster 截帧海报(dataURL)
  → ① 聊天气泡内联 <video controls> 播放  ② 派发 jarvis:video-ready → VideoWindow 聚合卡片
```

展示双视图：聊天气泡（主视图）+ 独立窗口（聚合/放大 lightbox）。

---

## 2. 数据模型

**视频对象 `VideoAttachment`**
```js
{ id, source:"attach"|"generate", role:"user"|"ai", name, mime,
  sizeBytes, durationSec, width, height,
  posterUrl,            // dataURL 或远程
  srcUrl,               // objectURL(本地) 或远程地址
  storage:"indexeddb"|"remote", status:"uploading"|"ready"|"error",
  createdAt }
```

**聊天历史**：沿用 `state.history`，视频项加 `attachments:[{id,name,mime,posterUrl,storage,srcRemoteUrl?}]`。
关键区别：图片 dataURL 全内联 localStorage；**视频 Blob 过大须存 IndexedDB（只存 id），重载时用 `videoStore.getBlobUrl(id)` 重建 objectURL，用完 `revoke` 防泄漏**。

---

## 3. UI 交互

- **输入区**：`ChatComposer` 发送按钮旁新增 📎 按钮 → 隐藏 `<input type=file accept=video/*>`，受控于 `VIDEO_CONFIG.enabled`。
- **聊天内联**：`appendVideoMessage(role, video)` 追加气泡，含 `<video class=chat-video controls preload=metadata poster src>` + 文件名/时长行。文件名走 `textContent` 防 XSS；点击放大到 lightbox。
- **独立窗口**：`VideoWindow.jsx` 镜像 `ImageWindow`（Portal + 拖拽 + 三态 pending/ready/error + lightbox + 下载）。
- **头部入口**：`ChatHeader` 加「视频」按钮，`activeTask==="task-video"` + `jarvis:video-start` 自动开窗口（同配图）。

---

## 4. 存储与播放

| 模式 | 方式 |
|---|---|
| **local（默认，无后端）** | `videoStore.js` 封装 IndexedDB，存 Blob；`URL.createObjectURL` 生成 `srcUrl`，浏览器原生支持拖拽/seek |
| **remote（可选）** | `POST /api/video-upload` 落盘，`/api/video/<id>` 走 Range 请求（拖拽必备） |

- **海报**：`videoPoster.js` 隐藏 `<video>` seek 到 1s 中点 → canvas → `toDataURL` 作 `poster`。
- **播放**：内联/卡片 `controls muted preload=metadata`；lightbox `autoplay`；生成模式同卡片。
- **校验**：MIME 白名单 + `maxSizeMB` + `maxDurationSec`，超限走 error 态，不阻断对话。

---

## 5. 文件清单（同构配图，机械可落地）

**新增**
- `src/config/videoConfig.js` — 镜像 `imageConfig.js`
- `src/lib/videoClient.js` — 镜像 `imageGenClient.js`（attach + generate 双路径）
- `src/lib/videoStore.js` — IndexedDB 封装（新增）
- `src/lib/videoPoster.js` — 截帧海报（镜像 `localImageRenderer.js`）
- `src/lib/videoPipeline.js` — 镜像 `imagePipeline.js`（事件桥 + regen）
- `src/components/viz/VideoWindow.jsx` + `VideoProviderSwitcher.jsx` — 镜像 ImageWindow
- `server/video-proxy.mjs` — 镜像 `image-proxy.mjs`（上传 + Range + 生成）
- `src/lib/videoProviderManager.js` / `videoPromptOptimizer.js` — 生成模式用

**修改（最小侵入）**
- `ChatPanel.jsx` — 附件按钮 + 头部入口
- `useChatController.js` — `handleAttach` + `appendVideoMessage` + 历史还原
- `App.jsx` — 挂 `VideoWindow` + 监听自动开
- `cyber.css` — `.video-window`/`.vw-*`/`.chat-video`
- `vite.config.js` — `/api/video-upload`、`/api/video`、`/api/genvideo`

---

## 6. 实施分期

1. **P0** 配置 + `videoStore` + `videoPoster` + `videoClient.attach`（local），纯新增零侵入。
2. **P1** 输入区按钮 + 内联展示（最小可用"发送+展示"）。
3. **P2** `VideoWindow` + 事件桥 + App 接入 + 头部按钮。
4. **P3** 服务端 remote 模式（上传/Range/生成 + 代理 + 供应商切换），默认仍 local。

---

## 7. 待你确认（4 点）

1. **主模式**：用户上传（已默认）还是 AI 文生视频优先？
2. **存储**：纯本地 IndexedDB（推荐默认）还是需后端持久化（跨设备）？
3. **展示**：以内联气泡为主、窗口聚合为辅（已默认），还是反过来？
4. **生成供应商**：若做生成模式，需确定 T2V 供应商及密钥/接口（参照 image-proxy 适配器接入）。
