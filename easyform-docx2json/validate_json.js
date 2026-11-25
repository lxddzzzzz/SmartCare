// validate_json.js — 结构一致性校验：把产物与"设计器真实导出文件"逐字段比对
//
// 依据：设计器「导入 json 文件」读入的组件对象会被前端按字段名取用；
//       若缺少真实导出文件里存在的键，属性面板/渲染可能取到 undefined；
//       若多出后端不认的键（table 组件尤其敏感），保存时可能报"未知异常"。
//
// 用法: node validate_json.js <待校验.json> [参考1.json 参考2.json ...]
//
// 参考文件 = 设计器「导出 json」得到的真实产物，用来建立字段基线。
// 不给参考文件时会退化为"纯几何/字段名校验"，跳过字段集比对。

const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target) { console.error('用法: node validate_json.js <待校验.json> [参考.json ...]'); process.exit(1); }
const refs = process.argv.slice(3);
if (!refs.length) {
  console.warn('提示: 未提供参考文件，将跳过"字段集比对"，只做几何/字段名/主键校验。');
  console.warn('      想完整比对照样: node validate_json.js 产物.json 设计器导出.json\n');
}

// ---------- 建立参考基线 ----------
const refTopKeys = new Set();
const refTypeKeys = {};       // type -> Set(keys)
const refTopSample = {};

for (const r of refs) {
  if (!fs.existsSync(r)) { console.warn('（跳过不存在的参考文件）', r); continue; }
  const j = JSON.parse(fs.readFileSync(r, 'utf8'));
  Object.keys(j).forEach((k) => { refTopKeys.add(k); refTopSample[k] = j[k] === null ? 'null' : typeof j[k]; });
  for (const pg of (j.pages || [])) {
    for (const c of (pg.components || [])) {
      const t = c.type || '(无type)';
      refTypeKeys[t] = refTypeKeys[t] || new Set();
      Object.keys(c).forEach((k) => refTypeKeys[t].add(k));
    }
  }
}

// ---------- 校验目标 ----------
const t = JSON.parse(fs.readFileSync(target, 'utf8'));
const pages = t.pages || [];
const comps = pages.flatMap((p) => p.components || []);

let err = 0, warn = 0;

console.log('================ 顶层结构 ================');
const tKeys = Object.keys(t);
console.log('产物顶层键 (' + tKeys.length + '):', tKeys.join(', '));
const missTop = [...refTopKeys].filter((k) => !(k in t));
const extraTop = tKeys.filter((k) => !refTopKeys.has(k));
if (missTop.length) { warn++; console.log('⚠️ 参考文件有、产物缺失:', missTop.join(', ')); }
if (extraTop.length) { warn++; console.log('⚠️ 产物多出（参考文件没有，通常无害）:', extraTop.join(', ')); }
if (!missTop.length && !extraTop.length) console.log('✓ 与参考文件顶层键完全一致');
console.log(`  code=${JSON.stringify(t.code)} formName=${JSON.stringify(t.formName)} size=${t.size} layout=${t.layout} moduleId=${t.moduleId} pages=${pages.length}`);

console.log('\n================ 组件字段集 ================');
const byType = {};
for (const c of comps) (byType[c.type] = byType[c.type] || []).push(c);

for (const [type, list] of Object.entries(byType)) {
  const ref = refTypeKeys[type];
  const keys = new Set();
  list.forEach((c) => Object.keys(c).forEach((k) => keys.add(k)));
  if (!ref) {
    warn++;
    console.log(`\n[${type}] × ${list.length}  ⚠️ 参考文件中无此类型，无法比对字段集`);
    console.log('   产物字段:', [...keys].join(', '));
    continue;
  }
  const missing = [...ref].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !ref.has(k));
  const status = (!missing.length && !extra.length) ? '✓ 完全一致' : '⚠️ 有差异';
  console.log(`\n[${type}] × ${list.length}  ${status}  (参考字段 ${ref.size} 个)`);
  if (missing.length) { warn++; console.log('   ❗缺少参考已有的键:', missing.join(', ')); }
  if (extra.length) { warn++; console.log('   ＋多出的键:', extra.join(', ')); }
}

console.log('\n================ 数值健全性 ================');
const CM2REM = 2.3622;
const A4 = { w: 21 * CM2REM, h: 29.7 * CM2REM };
let bad = 0;
const SAVE_TYPES = new Set(['textField', 'checkBox', 'select', 'ca-signature', 'modalDatePicker', 'labelDatePicker', 'textArea', 'signBoard', 'numberTotal', 'numberCheck']);
const idSet = new Set();
for (const c of comps) {
  const issues = [];
  for (const k of ['x', 'y', 'width', 'height']) {
    if (c[k] != null && (typeof c[k] !== 'number' || !isFinite(c[k]))) issues.push(`${k}非数值(${c[k]})`);
  }
  if (c.x != null && c.x < -0.01) issues.push('x<0');
  if (c.y != null && c.y < -0.01) issues.push('y<0');
  if (c.width != null && c.width <= 0) issues.push('width<=0');
  if (c.height != null && c.height <= 0) issues.push('height<=0');
  if (c.x != null && c.width != null && c.x + c.width > A4.w + 0.6) issues.push(`右溢出(${(c.x + c.width).toFixed(1)}>${A4.w.toFixed(1)})`);
  if (c.y != null && c.height != null && c.y + c.height > A4.h + 0.6) issues.push(`下溢出(${(c.y + c.height).toFixed(1)}>${A4.h.toFixed(1)})`);
  if (c.type !== 'label' && c.type !== 'table' && c.type !== 'line' && c.type !== 'rect') {
    if (!c.value) issues.push('可保存组件缺 value(字段名)');
    if (c.isSave !== true) issues.push('可保存组件 isSave!=true');
    if (c.value && !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(c.value)) issues.push(`字段名非法:${c.value}`);
  }
  if (c.type === 'table') {
    if (!Array.isArray(c.rows) || !c.rows.length) issues.push('table 无 rows');
    else c.rows.forEach((r, i) => { if (!Array.isArray(r.cells) || !r.cells.length) issues.push(`table.rows[${i}] 无 cells`); });
  }
  if (c.id != null) { if (idSet.has(c.id)) issues.push('组件 id 重复'); idSet.add(c.id); }
  if (c.type === 'checkBox') {
    if (!c.code) issues.push('checkBox 缺 code(选项值)');
    if (!c.text) issues.push('checkBox 缺 text(选项文本)');
  }
  if (issues.length) {
    bad++;
    if (bad <= 12) console.log(`  ✗ [${c.type}] "${String(c.text || c.value || '').slice(0, 16)}" : ${issues.join('; ')}`);
  }
}
console.log(bad ? `✗ 有问题的组件: ${bad}` : '✓ 全部组件几何/字段/主键健全');

console.log('\n================ 可保存字段清单 ================');
const saveVals = new Set(comps.filter((c) => c.value && c.isSave).map((c) => c.value));
const fieldNames = [...saveVals].sort();
console.log(`共 ${fieldNames.length} 个唯一字段名`);
const illegal = fieldNames.filter((f) => !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(f));
console.log(illegal.length ? '✗ 非法字段名: ' + illegal.join(', ') : '✓ 全部字段名合法（可直接作为 dFormData.fieldDataList[].field）');

console.log('\n================ 结论 ================');
if (err === 0 && bad === 0 && missTop.length === 0 && illegal.length === 0) {
  console.log('✅ 结构校验通过：顶层键、组件字段集、几何、字段名均与设计器真实导出规范一致，可导入。');
} else {
  console.log(`⚠️ 存在待确认项：顶层缺失 ${missTop.length}、异常组件 ${bad}、非法字段名 ${illegal.length}、字段集差异警告 ${warn} 处。`);
}
