// check_dup.js — 判定"重复 value"属于哪种（决定设计器是弹确认框还是直接报错）
const fs = require('fs');
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const all = (j.pages || []).flatMap((p) => p.components || []);
const byVal = {};
all.filter((c) => c.value && c.isSave).forEach((c) => {
  (byVal[c.value] = byVal[c.value] || []).push(c);
});

let onlyCB = 0, mixed = 0;
console.log('=== 重复的 value（保存时会被设计器标红）===');
Object.entries(byVal).forEach(([v, arr]) => {
  if (arr.length < 2) return;
  const types = [...new Set(arr.map((c) => c.type))];
  const ok = arr.every((c) => c.type === 'checkBox');
  if (ok) onlyCB++; else mixed++;
  console.log(`  ${v}  ×${arr.length}  类型=[${types.join(',')}]  ` + (ok ? '✓ 全是 checkBox → 点“确定”即可保存' : '✗ 混有非 checkBox → 会报错，必须改'));
});
console.log(`\n全 checkBox 的组: ${onlyCB}    混有非 checkBox 的组: ${mixed}`);

// 额外：patient.* 被当勾选组用（患者字段是只读的，不该被勾选覆盖）
const patCB = Object.entries(byVal).filter(([v, arr]) => v.startsWith('patient.') && arr.some((c) => c.type === 'checkBox'));
if (patCB.length) {
  console.log('\n⚠️ 以下 patient.* 被用作勾选组（患者信息是只读字段，建议改 form.*）:');
  patCB.forEach(([v, arr]) => console.log(`  ${v} ×${arr.length} (${arr.map((c) => c.type).join(',')})`));
}
