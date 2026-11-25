// dump_layout.js — 把导入 JSON 按"视觉行"还原成文本预览，便于人工核对布局
// 用法: node dump_layout.js <file.json> [--rem|--cm]
const fs = require('fs');
const CM2REM = 2.3622;
const p = process.argv[2];
const unit = process.argv.includes('--cm') ? 'cm' : 'rem';
const K = unit === 'cm' ? 1 / CM2REM : 1;
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const pages = j.pages || [];

const fmt = n => String(Math.round(n * K * 100) / 100);

pages.forEach((pg, pi) => {
  const comps = (pg.components || []).slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  console.log(`\n================ 第 ${pi + 1} 页 (${comps.length} 组件) ================`);
  let curY = null, row = [];
  const flush = () => {
    if (!row.length) return;
    row.sort((a, b) => a.x - b.x);
    const parts = row.map(c => {
      let label = c.type;
      let body = '';
      if (c.type === 'label') body = JSON.stringify(String(c.text == null ? '' : c.text));
      else if (c.type === 'table') body = `[${(c.rows || []).length}行×${((c.rows || [])[0] || {}).cells ? c.rows[0].cells.length : 0}格]`;
      else if (c.type === 'checkBox') body = `☑"${c.text}"`;
      else body = `{${c.value || c.code || '-'}}${c.text ? ` "${c.text}"` : ''}`;
      return `<${label} x=${fmt(c.x)} w=${fmt(c.width)}>${body}`;
    });
    console.log(`y=${fmt(curY).padStart(7)} │ ` + parts.join('  '));
    row = [];
  };
  for (const c of comps) {
    const y = c.y || 0;
    if (curY === null) curY = y;
    if (Math.abs(y - curY) > 0.5) { flush(); curY = y; }
    row.push(c);
  }
  flush();
});
