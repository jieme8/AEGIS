#!/usr/bin/env node
// =========================================================
// dev-precheck — 端口预检：杀掉占用端口的进程，避免 concurrently 起冲突。
// 用法：node scripts/dev-precheck.mjs <port> [port ...]
// 设计：
//   - lsof -ti:<port> 拿 PID（-t 仅返回 PID，无表头），逐个 kill -9
//   - ANSI 颜色让终端提示一眼看清（空闲绿 / 占用黄 / 杀掉提示）
//   - 始终 exit 0：清理是用户预期行为，不因某个端口杀不掉就阻断启动
// =========================================================
import { execSync } from "node:child_process";

const C = {
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  rst: "\x1b[0m",
};
const OK = `${C.green}✓${C.rst}`;
const KILL = `${C.yellow}⚠${C.rst}`;

const ports = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);

if (!ports.length) {
  console.log(`${C.dim}dev-precheck: 未指定端口，跳过预检${C.rst}`);
  process.exit(0);
}

function clearPort(port) {
  let pids = "";
  try {
    pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf8" }).trim();
  } catch {
    return { port, status: "free", killed: [] };
  }
  if (!pids) return { port, status: "free", killed: [] };
  const list = pids.split(/\s+/).filter(Boolean);
  for (const pid of list) {
    try {
      process.kill(Number(pid), 9);
    } catch {
      // 进程已退（race），忽略
    }
  }
  return { port, status: "killed", killed: list };
}

console.log(
  `${C.bold}${C.cyan}dev-precheck${C.rst} ${C.dim}→ 扫描 ${ports.length} 个端口…${C.rst}`
);

let killedAny = false;
for (const port of ports) {
  const r = clearPort(port);
  if (r.status === "free") {
    console.log(`  ${OK} ${C.dim}:${port} 空闲${C.rst}`);
  } else {
    killedAny = true;
    console.log(
      `  ${KILL} ${C.yellow}:${port} 占用${C.rst} ${C.dim}(pid ${r.killed.join(", ")}) → 已释放${C.rst}`
    );
  }
}

if (killedAny) {
  console.log(`${C.yellow}清理完成${C.rst} ${C.dim}→ 启动 dev${C.rst}\n`);
} else {
  console.log(`${C.green}端口干净${C.rst} ${C.dim}→ 启动 dev${C.rst}\n`);
}
