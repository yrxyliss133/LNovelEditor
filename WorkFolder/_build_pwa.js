#!/usr/bin/env node
/*
 * 打包单文件 PWA
 *  1. 生成图标 base64 data URI
 *  2. 把 __PWA_ICONS__ 注入 pwa.js
 *  3. 合并 index.html + style.css + 各 js -> 单个 HTML
 *  4. 校验
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'lavender-novel-pwa.html');

// ---------- 1. 图标 ----------
console.log('[1/4] 生成图标 data URI');
execFileSync('python3', ['/tmp/mk_pwa_icons.py'], { encoding: 'utf8' });
const ICONS = JSON.parse(fs.readFileSync('/tmp/pwa_icons.json', 'utf8'));
console.log('      icon192 %d, icon512 %d, maskable %d, favicon %d (chars)',
  ICONS.icon192.length, ICONS.icon512.length, ICONS.maskable512.length, ICONS.favicon64.length);

// ---------- 2. 读取源码 ----------
console.log('[2/4] 读取源文件');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css  = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const NAMES = ['db.js', 'app.js', 'timeline.js', 'setting.js',
               'export.js', 'backup.js', 'search.js', 'storage.js',
               'native.js', 'pwa.js'];
const parts = NAMES.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);

for (const [n, t] of [...parts, ['style.css', css]]) {
  if (t.includes('</script>')) throw new Error(n + ' 含 </script>');
  if (t.includes('</style>')) throw new Error(n + ' 含 </style>');
}

// ---------- 3. 组装 ----------
console.log('[3/4] 组装单文件');
const iconScript = 'window.__PWA_ICONS__ = ' + JSON.stringify(ICONS) + ';\n';

let out = html;
out = out.replace(/[ \t]*<link rel="stylesheet" href="style\.css">\n?/,
  '<style>\n' + css.trimEnd() + '\n</style>\n');

const srcPattern = new RegExp(
  NAMES.map((f) => '[ \\t]*<script src="' + f.replace('.', '\\.') + '"><\\/script>').join('\\n') + '\\n?');
const scripts = '<script>\n' + iconScript + '</script>\n' +
  parts.map(([, t]) => '<script>\n' + t.trim() + '\n</script>').join('\n') + '\n';
out = out.replace(srcPattern, () => scripts);

out = out.replace('</body>',
  '<script>\n' +
  'if (document.readyState === "loading") {\n' +
  '  document.addEventListener("DOMContentLoaded", bootPWA);\n' +
  '} else { bootPWA(); }\n' +
  '</script>\n</body>');

if (/<link[^>]+style\.css/.test(out)) throw new Error('CSS 未内联');
const leftover = out.match(/<script[^>]+src=/);
if (leftover) throw new Error('JS 未内联: ' + leftover[0]);

fs.writeFileSync(OUT, out, 'utf8');

// ---------- 4. 校验 ----------
console.log('[4/4] 校验单文件');
const txt = fs.readFileSync(OUT, 'utf8');
const size = fs.statSync(OUT).size;
const checks = [
  ['单文件：无外部 script', !/<script[^>]+src=/.test(txt)],
  ['单文件：无外部 link', !/<link[^>]+href="(?!data:)/.test(txt)],
  ['图标已内联为 base64', txt.includes('data:image/png;base64,')],
  ['manifest 用 data URI', txt.includes('application/manifest+json')],
  ['含 Fennec 检测', txt.includes('isFennec')],
  ['含 UA 判定（Firefox）', txt.includes('fxios') || txt.includes('/firefox/')],
  ['含持久存储申请', txt.includes('storage.persist')],
  ['含 persist 确认弹窗', txt.includes('申请持久存储')],
  ['含 IndexedDB', txt.includes('indexedDB.open')],
  ['应用名正确', txt.includes('薰小说编辑器')],
  ['主题色', txt.includes('#17102A') || txt.includes('#17102a')],
];
let bad = 0;
for (const [n, ok] of checks) {
  console.log('      ' + (ok ? 'OK  ' : 'FAIL') + ' ' + n);
  if (!ok) bad++;
}
console.log('\n' + path.basename(OUT) + '  ' + size + ' bytes (' + (size / 1024).toFixed(1) + ' KB)');
if (bad) { console.error(bad + ' 项校验失败'); process.exit(1); }
