import fs from "fs";
const src = "./src";
const read = (p) => fs.readFileSync(p, "utf8");
const walk = (d) => {
  let out = [];
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = d + "/" + f.name;
    if (f.isDirectory()) out = out.concat(walk(p));
    else if (/\.(jsx?|css)$/.test(f.name)) out.push(p);
  }
  return out;
};
const files = walk(src);
const css = files.filter((f) => f.endsWith(".css")).map(read).join("\n");
const cssClasses = new Set();
for (const m of css.matchAll(/\.([a-zA-Z0-9_-]+)/g)) cssClasses.add(m[1]);
const used = new Set();
for (const f of files.filter((x) => /\.jsx?$/.test(x))) {
  const t = read(f);
  for (const m of t.matchAll(/className=(?:"([^"]*)"|`([^`]*)`)/g)) {
    const seg = (m[1] || m[2] || "");
    for (const tok of seg.split(/[\s{}$"`]+/)) {
      if (/^[a-zA-Z0-9_-]+$/.test(tok) && tok) used.add(tok);
    }
  }
}
const missing = [...used].filter((c) => !cssClasses.has(c)).sort();
console.log("CSS 类总数:", cssClasses.size);
console.log("组件使用类名总数:", used.size);
console.log("未匹配到 CSS 的类名:", missing.length ? missing : "(无)");
