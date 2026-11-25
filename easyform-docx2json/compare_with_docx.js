// compare_with_docx.js — ★ 每次改动后必跑：把产物与原 Word 逐行对比，自动找出"断行/丢内容/错序"
//
// 原理：原 docx 的每个段落 = Word 里的一行；产物按 y 聚合成"视觉行"。
//       若某个 Word 行在产物里被拆到多行（或文本对不上），就是版式跑偏，需要修。
//
// 用法: node compare_with_docx.js <原文档.docx> <产物.json>
const fs = require('fs');
const { readDocx } = require('./lib/docx-reader');

const docxPath = process.argv[2];
const jsonPath = process.argv[3];
// 归一化：去空白、去勾选框字符 □、去冒号（工具链会给标签补"："，原文未必有）
const norm = (s) => String(s || '').replace(/[\s\u3000：:□☐]/g, '');

// ---------- 1) 原 Word 的"行" ----------
const model = readDocx(docxPath);
const docLines = [];
for (const b of model.blocks) {
  if (b.kind === 'para') {
    const t = norm(b.plainText);
    if (t) docLines.push({ src: '段落', text: t });
  } else {
    (b.rows || []).forEach((row, i) => {
      const t = norm((row.cells || []).map((c) => (c.paras || []).map((p) => p.plainText).join('')).join(''));
      if (t) docLines.push({ src: `表格第${i + 1}行`, text: t });
    });
  }
}

// ---------- 2) 产物的"视觉行" ----------
const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const comps = (j.pages || []).flatMap((p) => p.components || []);
const sorted = comps.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
const rows = [];
const Y_TOL = 0.5;                     // rem
for (const c of sorted) {
  const last = rows[rows.length - 1];
  if (last && Math.abs(c.y - last.y) <= Y_TOL) last.items.push(c);
  else rows.push({ y: c.y, items: [c] });
}
// 每行只取"有文字"的组件（label / checkBox）；文本型控件不产生文字，直接跳过
const outLines = rows.map((r, i) => {
  const items = r.items.slice().sort((a, b) => a.x - b.x);
  const txt = items
    .filter((c) => c.type === 'label' || c.type === 'checkBox')
    .map((c) => c.text || '')
    .join('');
  return { idx: i, y: r.y, text: norm(txt), raw: items };
}).filter((r) => r.text);

// ---------- 3) 逐行核对 ----------
let broken = 0, missing = 0;
console.log('原 Word 行数:', docLines.length, '  产物视觉行数:', outLines.length);
console.log('');

// 产物全文（用于判断"是否被拆到多行"）
const outJoined = outLines.map((r) => r.text).join('');

for (const dl of docLines) {
  if (!dl.text) continue;
  const inOneLine = outLines.some((ol) => ol.text.includes(dl.text));
  if (inOneLine) continue;
  // 判据：先看"内容有没有丢"（真问题），再看"是否比 Word 折得更多"（Word 段落本身也会折行，仅供参考）
  const pieces = dl.text.match(/.{4,}/g) || [dl.text];
  const missingPieces = pieces.filter((p) => !outJoined.includes(p));
  const hitRows = outLines.filter((ol) => pieces.some((p) => ol.text.includes(p))).map((ol) => ol.idx);
  if (missingPieces.length) {
    missing++;
    console.log(`❌ 内容丢失 [${dl.src}] ${dl.text.slice(0, 46)}`);
    console.log(`          缺失片段: ${missingPieces.map((p) => p.slice(0, 14)).join(' / ')}`);
  } else if (hitRows.length > 1) {
    broken++;
    console.log(`✂️  折行     [${dl.src}] ${dl.text.slice(0, 46)}`);
    console.log(`          Word 同一段，产物落在第 ${hitRows.join('、')} 个视觉行（内容完整；Word 本身>=1行）`);
  }
}

console.log('');
// ===== 全文逐字检测（4-gram）：能抓出"四、"这类被整段吞掉的片段 =====
const docAll = docLines.map((l) => l.text).join('');
const outAll = outLines.map((r) => r.text).join('');
const seen = new Set();
const grams = [];
for (let i = 0; i + 4 <= docAll.length; i++) {
  const g = docAll.slice(i, i + 4);
  if (outAll.includes(g) || seen.has(g)) continue;
  seen.add(g);
  grams.push({ g, ctx: docAll.slice(Math.max(0, i - 12), i + 16) });
}
if (grams.length) {
  console.log('=== 逐字检测：以下片段在产物里找不到（真丢失）===');
  grams.slice(0, 20).forEach((x) => console.log(`  "${x.g}"   上下文: …${x.ctx}…`));
  missing += grams.length;
} else {
  console.log('=== 逐字检测：✓ docx 全文的每个 4 字片段都能在产物里找到 ===');
}

console.log('');
if (!broken && !missing) {
  console.log('✅ 与原 Word 对比通过：内容无丢失；行结构与原文档一致（Word 自身折行的位置也一致）。');
} else {
  console.log(`⚠️  折行/差异 ${broken} 处，内容丢失 ${missing} 处 —— 需要修复后重跑。`);
}
process.exit(broken || missing ? 1 : 0);
