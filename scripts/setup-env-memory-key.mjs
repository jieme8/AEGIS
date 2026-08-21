#!/usr/bin/env node
// =========================================================
// setup-env-memory-key — 确保 .env 里有 VITE_LONGCAT_API_KEY。
//
// 背景：vite.config.js 的 /api/longcat 代理在没有浏览器自带 Authorization 时，
// 用 VITE_LONGCAT_API_KEY 兜底注入；而 .env 里通常只写 VITE_LONGCAT_API_KEYS
// （多 key，可带 @过期日）。两者缺一时 /api/longcat 可能以空密钥转发 → 401。
//
// 注：memory MCP 的 embedding 已改用本地 Ollama（见 server/memory/embed.mjs），
// 不再依赖本 key；本脚本仅用于保证 LongCat 聊天代理配置完整。
//
// 用法：node scripts/setup-env-memory-key.mjs
// 行为：
//   - 若已存在 VITE_LONGCAT_API_KEY → 直接跳过（幂等）
//   - 否则从 VITE_LONGCAT_API_KEYS 取第一个 key（剥掉 @date / :model 后缀）追加一行
//   - 从不覆盖已有配置；密钥值绝不打印到终端
// =========================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");
const TARGET_KEY = "VITE_LONGCAT_API_KEY";
const SOURCE_KEY = "VITE_LONGCAT_API_KEYS";

const C = {
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  rst: "\x1b[0m",
};
const OK = `${C.green}✓${C.rst}`;
const WARN = `${C.yellow}⚠${C.rst}`;
const FAIL = `${C.red}✗${C.rst}`;

function stripQuotes(v) {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function parseDotEnv(txt) {
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = stripQuotes(m[2].trim());
  }
  return out;
}

function extractFirstKey(keysRaw) {
  const first = (keysRaw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (!first) return "";
  // 剥掉 @过期日 与 :model 前缀段
  return first.split("@")[0].split(":")[0].trim();
}

if (!fs.existsSync(ENV_PATH)) {
  console.log(`${FAIL} 未找到 ${ENV_PATH}，请在项目根先创建 .env`);
  process.exit(1);
}

const txt = fs.readFileSync(ENV_PATH, "utf8");
const env = parseDotEnv(txt);

if (env[TARGET_KEY]) {
  console.log(
    `${OK} ${TARGET_KEY} 已配置${C.dim}（长度 ${env[TARGET_KEY].length}，无需追加）${C.rst}`
  );
  process.exit(0);
}

const firstKey = extractFirstKey(env[SOURCE_KEY]);
if (!firstKey) {
  console.log(
    `${WARN} 未找到 ${SOURCE_KEY}（或该键为空），无法自动生成 ${TARGET_KEY}，请在 .env 中手动填写`
  );
  process.exit(1);
}

const append = `${TARGET_KEY}=${firstKey}`;
const newTxt = txt.endsWith("\n")
  ? txt + append + "\n"
  : txt + "\n" + append + "\n";

fs.writeFileSync(ENV_PATH, newTxt, "utf8");
console.log(
  `${OK} 已从 ${SOURCE_KEY} 提取第一个 key 追加到 ${ENV_PATH}${C.dim}（密钥值未打印）${C.rst}`
);
console.log(
  `${C.dim}   ${TARGET_KEY}=<已设置>${C.rst}${C.dim}  → memory embedding 可正常使用${C.rst}`
);