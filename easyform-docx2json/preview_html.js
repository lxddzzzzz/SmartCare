// preview_html.js — 把设计器导入 JSON 渲染成可打印的 HTML 预览（无需打开设计器即可核对版式）
// 用法: node preview_html.js <表单.json> [输出.html]
//
// 渲染基准与设计器一致：1 rem = 16px（设计器 page-container font-size:16px），
// 故 A4 = 49.6rem × 70.16rem ≈ 793px × 1122px（96dpi A4）。

const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) { console.error('用法: node preview_html.js <表单.json> [输出.html]'); process.exit(1); }
const outPath = process.argv[3] || src.replace(/\.json$/i, '.preview.html');

const j = JSON.parse(fs.readFileSync(src, 'utf8'));
const comps = (j.pages || []).flatMap((p) => p.components || []);
const px = (rem) => (Number(rem || 0) * 16).toFixed(1);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderComp(c) {
  const base = `position:absolute;left:${px(c.x)}px;top:${px(c.y)}px;width:${px(c.width)}px;height:${px(c.height)}px;` +
    `font-size:${px(c.fontSize)}px;line-height:${px(c.height)}px;font-family:宋体,SimSun,serif;box-sizing:border-box;`;
  const t = c.type;
  if (t === 'label') {
    const weight = c.fontWeight ? 'font-weight:700;' : '';
    const color = c.color ? `color:${c.color};` : '';
    return `<div style="${base}${weight}${color}white-space:pre;" title="label">${esc(c.text)}</div>`;
  }
  if (t === 'checkBox') {
    return `<div style="${base}white-space:nowrap;overflow:visible;" title="${esc(c.value)}｜code=${esc(c.code)}｜多选=${c.multiSelect}">` +
      `<span style="display:inline-block;width:${px(c.fontSize)}px;height:${px(c.fontSize)}px;border:1px solid #333;vertical-align:-0.1em;margin-right:2px;background:#fff;"></span>${esc(c.text)}</div>`;
  }
  if (t === 'textField') {
    const border = c.isNoBorder ? 'border-bottom:1px solid #8a8a8a;' : 'border:1px solid #8a8a8a;';
    return `<div style="${base}${border}background:rgba(64,158,255,0.05);" title="字段 ${esc(c.value)}${c.readonly ? '（患者信息·只读）' : ''}"></div>`;
  }
  if (t === 'modalDatePicker' || t === 'labelDatePicker') {
    return `<div style="${base}border-bottom:1px solid #8a8a8a;background:rgba(255,193,7,0.10);color:#8a6d00;" title="字段 ${esc(c.value)}｜格式 ${esc(c.format)}">日期</div>`;
  }
  if (t === 'ca-signature') {
    return `<div style="${base}border-bottom:1px solid #8a8a8a;background:rgba(156,39,176,0.08);color:#6a1b76;" title="签名字段 ${esc(c.value)}">签名</div>`;
  }
  if (t === 'table') {
    const cells = ((c.rows || [])[0] || {}).cells || [];
    let x = 0;
    let inner = '';
    for (const cell of cells) {
      const w = Number(cell.width || 0);
      inner += `<div style="position:absolute;left:${px(x)}px;top:0;width:${px(w)}px;height:${px(c.height)}px;border-right:1px solid #444;box-sizing:border-box;"></div>`;
      x += w;
    }
    return `<div style="${base}border:1px solid #444;background:transparent;" title="表格边框组件">${inner}</div>`;
  }
  return `<div style="${base}background:rgba(0,0,0,0.06);" title="${esc(t)}"></div>`;
}

const bodyHtml = comps.slice().sort((a, b) => a.y - b.y || a.x - b.x).map(renderComp).join('\n');

// 字段清单
const fieldRows = {};
for (const c of comps) {
  if (!c.value || !c.isSave) continue;
  const k = c.value;
  fieldRows[k] = fieldRows[k] || { type: c.type, count: 0, options: [] };
  fieldRows[k].count++;
  if (c.type === 'checkBox') fieldRows[k].options.push(`${c.text}(${c.code})`);
}
const fieldTable = Object.entries(fieldRows).sort((a, b) => a[0].localeCompare(b[0]))
  .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v.type)}</td><td>${v.count}</td><td>${esc(v.options.join(' / '))}</td></tr>`).join('\n');

const byType = {};
comps.forEach((c) => (byType[c.type] = (byType[c.type] || 0) + 1));
const maxY = Math.max(...comps.map((c) => (c.y || 0) + (c.height || 0)), 0);

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>预览 · ${esc(j.formName)}</title>
<style>
  body{margin:0;padding:24px;background:#eceff1;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#222;}
  .wrap{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;}
  .page{width:793px;height:1122px;background:#fff;position:relative;box-shadow:0 2px 12px rgba(0,0,0,.18);flex:0 0 auto;}
  .meta{background:#fff;border-radius:8px;padding:16px 20px;box-shadow:0 2px 12px rgba(0,0,0,.10);max-width:860px;}
  .meta h2{margin:0 0 4px;font-size:18px;}
  .meta .sub{color:#607d8b;font-size:13px;margin-bottom:12px;}
  table{border-collapse:collapse;font-size:12.5px;width:100%;}
  th,td{border:1px solid #cfd8dc;padding:4px 8px;text-align:left;vertical-align:top;}
  th{background:#f5f7f8;}
  code{background:#f1f3f4;padding:1px 4px;border-radius:3px;}
  .legend span{display:inline-block;margin-right:14px;font-size:12.5px;}
  .box{display:inline-block;width:12px;height:12px;border:1px solid #333;vertical-align:-2px;margin-right:4px;}
  .ul{display:inline-block;width:26px;border-bottom:1px solid #8a8a8a;vertical-align:-2px;margin-right:4px;}
</style></head>
<body>
<div class="wrap">
  <div class="page">
${bodyHtml}
  </div>
  <div class="meta">
    <h2>${esc(j.formName)}</h2>
    <div class="sub">表单代码 <code>${esc(j.code)}</code> ｜ 纸张 ${esc(j.size)} ｜ 方向 ${esc(j.layout)} ｜ 页边距 ${j.paddingTop}/${j.paddingBottom}/${j.paddingLeft}/${j.paddingRight} mm ｜ 组件 ${comps.length} 个</div>
    <div class="legend">
      <span><span class="box"></span>勾选框</span>
      <span><span class="ul"></span>输入框</span>
      <span>类型分布：${Object.entries(byType).map(([k, v]) => k + '×' + v).join('，')}</span>
    </div>
    <p style="font-size:12.5px;color:#546e7a;margin:10px 0 8px;">
      内容最低点 <b>${(maxY / 2.3622).toFixed(1)} cm</b> / A4 高 29.7 cm ｜ 可保存字段 <b>${Object.keys(fieldRows).length}</b> 个
    </p>
    <table>
      <thead><tr><th>字段名(value)</th><th>类型</th><th>组件数</th><th>选项 / code</th></tr></thead>
      <tbody>
${fieldTable}
      </tbody>
    </table>
  </div>
</div>
</body></html>`;

fs.writeFileSync(outPath, html, 'utf8');
console.log('✓ 预览已生成:', outPath);
console.log(`  组件 ${comps.length} 个，可保存字段 ${Object.keys(fieldRows).length} 个，内容最低点 ${(maxY / 2.3622).toFixed(1)}cm`);
