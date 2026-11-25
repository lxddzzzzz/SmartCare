// check_json.js — 质检 eaxy-form 设计器导入 JSON
// 用法: node check_json.js <file.json>
const fs = require('fs');

const CM2REM = 2.3622;                 // 与 buildForm.js 一致
const A4 = { w: 21 * CM2REM, h: 29.7 * CM2REM };   // rem

const p = process.argv[2];
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const pages = j.pages || [];
const comps = [];
pages.forEach((pg, pi) => (pg.components || []).forEach(c => comps.push(Object.assign({ _page: pi }, c))));

const r2 = n => Math.round(n * 100) / 100;

console.log('=========== 表单元信息 ===========');
console.log('formName :', j.formName);
console.log('code     :', j.code);
console.log('size/layout:', j.size, '/', j.layout);
console.log('padding  :', `T${j.paddingTop} B${j.paddingBottom} L${j.paddingLeft} R${j.paddingRight}`);
console.log('pages    :', pages.length, ' 组件总数:', comps.length);

console.log('\n=========== 组件类型分布 ===========');
const byType = {};
for (const c of comps) byType[c.type] = (byType[c.type] || 0) + 1;
Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(4), k));

console.log('\n=========== ❗ 未转换的勾选框(残留 □ label) ===========');
const boxLabels = comps.filter(c => c.type === 'label' && String(c.text || '').includes('□'));
console.log('数量:', boxLabels.length);
boxLabels.slice(0, 20).forEach(c => console.log(`   p${c._page} y=${r2(c.y)} x=${r2(c.x)} "${c.text}"`));
if (boxLabels.length > 20) console.log(`   ... 其余 ${boxLabels.length - 20} 个`);

console.log('\n=========== checkBox 分组(value) ===========');
const cbGroups = {};
comps.filter(c => c.type === 'checkBox').forEach(c => {
  const v = c.value || '(空)';
  (cbGroups[v] = cbGroups[v] || []).push(c.text || c.code);
});
Object.entries(cbGroups).forEach(([v, items]) => {
  const dup = items.length !== new Set(items).size ? '  ⚠️选项重复' : '';
  console.log(`  ${v}  (${items.length})  [${items.join(' | ')}]${dup}`);
});
console.log('checkBox 总数:', comps.filter(c => c.type === 'checkBox').length, ' 分组数:', Object.keys(cbGroups).length);

console.log('\n=========== 字段绑定 value 重复检测 ===========');
const usedVals = {};
comps.filter(c => c.value && c.isSave).forEach(c => {
  (usedVals[c.value] = usedVals[c.value] || []).push({ t: c.type, y: r2(c.y), x: r2(c.x), txt: c.text || c.code || '' });
});
let dupCount = 0, groupOk = 0;
Object.entries(usedVals).forEach(([v, arr]) => {
  if (arr.length > 1) {
    // 同一题组的多个 checkBox 共享 value 是"题组"的正确表示法（与成品表单一致），不算错误
    if (arr.every(a => a.t === 'checkBox')) { groupOk++; return; }
    dupCount++;
    console.log(`  ⚠️真重复 ${v} 出现 ${arr.length} 次:`, arr.map(a => `${a.t}@(${a.x},${a.y})"${a.txt}"`).join(', '));
  }
});
console.log('⚠️ 真重复(非题组) value 数:', dupCount, ' | ✓ 题组共享 value 组数:', groupOk, ' | 唯一 value 数:', Object.keys(usedVals).length);

console.log('\n=========== 患者信息绑定 ===========');
const pats = comps.filter(c => c.value && String(c.value).startsWith('patient.'));
const patVals = {};
pats.forEach(c => (patVals[c.value] = patVals[c.value] || []).push(c.text || c.code));
Object.entries(patVals).forEach(([v, a]) => console.log(`  ${v} × ${a.length}`));
console.log('patient.* 组件数:', pats.length);

console.log('\n=========== 几何越界检查 ===========');
let outCount = 0;
for (const c of comps) {
  const x = c.x || 0, y = c.y || 0, w = c.width || 0, h = c.height || 0;
  const issues = [];
  if (x < -0.01) issues.push(`x<0(${r2(x)})`);
  if (y < -0.01) issues.push(`y<0(${r2(y)})`);
  if (x + w > A4.w + 0.5) issues.push(`右溢出 x+w=${r2(x + w)} > ${r2(A4.w)}`);
  if (y + h > A4.h + 0.5) issues.push(`下溢出 y+h=${r2(y + h)} > ${r2(A4.h)}`);
  if (w <= 0 || h <= 0) issues.push(`非正尺寸 w=${r2(w)} h=${r2(h)}`);
  if (issues.length) { outCount++; if (outCount <= 15) console.log(`  ⚠️ [${c.type}] "${String(c.text || c.code || '').slice(0, 18)}" : ${issues.join('; ')}`); }
}
console.log('越界/异常组件数:', outCount);

console.log('\n=========== 重叠检查(仅同页 非表格 非线条, 重叠面积>40% 记为可疑) ===========');
function inter(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}
const solids = comps.filter(c => !['table', 'line', 'rect', 'svgLine'].includes(c.type) && c.width > 0 && c.height > 0);
const overl = [];
for (let i = 0; i < solids.length; i++) {
  for (let k = i + 1; k < solids.length; k++) {
    const a = solids[i], b = solids[k];
    if (a._page !== b._page) continue;
    const ov = inter(a, b);
    if (ov <= 0.0001) continue;
    const ratio = ov / Math.min(a.width * a.height, b.width * b.height);
    if (ratio > 0.4) overl.push({ a, b, ratio });
  }
}
console.log('可疑重叠对数:', overl.length);
overl.slice(0, 12).forEach(o => {
  console.log(`  p${o.a._page} ${Math.round(o.ratio * 100)}%  [${o.a.type}]"${String(o.a.text || o.a.code || '').slice(0, 12)}"@(${r2(o.a.x)},${r2(o.a.y)},${r2(o.a.width)}×${r2(o.a.height)})  ×  [${o.b.type}]"${String(o.b.text || o.b.code || '').slice(0, 12)}"@(${r2(o.b.x)},${r2(o.b.y)},${r2(o.b.width)}×${r2(o.b.height)})`);
});

console.log('\n=========== 内容纵向覆盖 ===========');
const ys = comps.map(c => (c.y || 0) + (c.height || 0));
console.log('最低点 y+h =', r2(Math.max(...ys)), 'rem   (A4 高', r2(A4.h), 'rem)');
console.log('内容填充率 =', r2(Math.max(...ys) / A4.h * 100) + '%');
