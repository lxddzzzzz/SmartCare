#!/usr/bin/env node
'use strict';
/**
 * easyform-docx2json.js — Word 文书(.docx) → eaxy-form 设计器"可导入 JSON"
 *
 * 用法：
 *   node easyform-docx2json.js "表单名__表单代码__医院名.docx" [更多.docx ...]
 *   node easyform-docx2json.js 文书.docx --formName 分娩镇痛麻醉评估与记录 --formCode fenmian... --out 输出目录
 *
 * 产物：与输入同名的 .json（设计器 → 文件 → 导入 json 文件）+ 同名 .unknown.txt（未命中词典的标签）
 */

const fs = require('fs');
const path = require('path');
const { readDocx } = require('./lib/docx-reader');
const { createRegistry } = require('./lib/field-map');
const FB = require('./lib/form-builder');
const { pinyin } = require('pinyin-pro');

function parseArgs(argv) {
  const files = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      opt[key] = val;
    } else files.push(a);
  }
  return { files, opt };
}

function toCode(s, maxLen = 40) {
  let parts;
  try { parts = pinyin(s, { toneType: 'none', type: 'array', nonZh: 'consecutive' }); } catch (e) { parts = []; }
  let out = parts.map((x) => String(x).replace(/[^a-zA-Z0-9]/g, '')).join('').toLowerCase();
  if (!out) out = 'form' + Date.now().toString(36);
  return out.slice(0, maxLen);
}

/** 文件名约定：表单名__表单代码__医院名.docx（兼容单下划线、也兼容直接给参数） */
function parseName(baseName, opt) {
  let formName = opt.formName || null;
  let formCode = opt.formCode || null;
  let hospitalName = opt.hospitalName || null;

  const parts = baseName.split(/_{1,2}/).filter(Boolean);
  if (!formName && parts.length >= 2) formName = parts[0];
  if (!formCode && parts.length >= 3) formCode = parts[1];
  if (!hospitalName && parts.length >= 3) hospitalName = parts[2];
  if (!formName) formName = baseName;
  if (!formCode) {
    // 文件名里若第二段看起来像代码（纯字母数字）就用它，否则拼音生成
    const cand = parts[1] && /^[a-zA-Z][a-zA-Z0-9]*$/.test(parts[1]) ? parts[1] : null;
    formCode = cand || toCode(formName);
  }
  return { formName, formCode: String(formCode).toLowerCase(), hospitalName: hospitalName || '' };
}

function convertOne(docxPath, opt) {
  const abs = path.resolve(docxPath);
  if (!fs.existsSync(abs)) throw new Error('文件不存在: ' + abs);
  const baseName = path.basename(abs).replace(/\.docx$/i, '');
  const { formName, formCode, hospitalName } = parseName(baseName, opt);

  const model = readDocx(abs);

  // ★ 按"设计器内容区宽度"排版，而不是 docx 自身的内文宽度：
  //   docx 常见左右页边距各 1.27cm，会把内容压窄到 ≈18.5cm；而设计器纸张 21cm、页边距 5mm，
  //   真实内容区 = 21 - 1 = 20cm。用 18.5cm 排会导致右侧空一截、整体不居中。
  //   留 0.3cm 余量：组件外壳(directive-wrap)比 width 外扩约 1.6px，占满会让画布出现水平溢出，
  //   溢出会让设计器画布滚动、元素截图错位（实测踩过）。
  const PAD_MM = opt.padding != null ? Number(opt.padding) : 5;
  const designUsableW = model.page.wCm - (PAD_MM / 10) * 2 - 0.3;
  if (designUsableW > 4) model.page.usableWcm = designUsableW;

  const registry = createRegistry();
  const built = FB.buildComponents(model, registry);
  const { components, contentHeightCm, pages, pageCount } = built;

  const layout = opt.layout || model.orientation;
  const form = FB.assemble({ formName, formCode, components, layout, paddingMm: PAD_MM, pages });

  const outDir = opt.out ? path.resolve(opt.out) : path.dirname(abs);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, baseName + '.json');
  fs.writeFileSync(outPath, JSON.stringify(form, null, 2), 'utf8');

  // 统计
  const byType = {};
  for (const c of components) byType[c.type] = (byType[c.type] || 0) + 1;
  const values = new Set(components.filter((c) => c.value).map((c) => c.value));
  const patientCount = components.filter((c) => String(c.value || '').startsWith('patient.')).length;

  const unknownPath = path.join(outDir, baseName + '.unknown.txt');
  if (registry.unknown.length) {
    fs.writeFileSync(unknownPath,
      ['未命中字段词典的中文标签（按出现顺序，可在 lib/field-map.js 的 FORM_HINTS 里补充以得到更可读的字段名）:',
        ...registry.unknown.map((s, i) => `${String(i + 1).padStart(3, '0')}. ${s}`)].join('\n') + '\n', 'utf8');
  } else if (fs.existsSync(unknownPath)) fs.unlinkSync(unknownPath);

  const pageHcm = model.page.hCm;
  return {
    outPath, formName, formCode, hospitalName, components: components.length,
    byType, uniqueValues: values.size, patientCount,
    contentHeightCm, pageHcm,
    pageCount: pageCount || 1,
    fillRatio: contentHeightCm / (pageHcm - 1.0),
    dedup: registry.stats.dedup, unknown: registry.unknown.length,
  };
}

function main() {
  const { files, opt } = parseArgs(process.argv.slice(2));
  if (!files.length) {
    console.log('用法: node easyform-docx2json.js <文书.docx> [更多.docx ...]');
    console.log('      可选: --formName 名称 --formCode 代码 --out 输出目录 --layout vertical|horizontal');
    process.exit(1);
  }
  let ok = 0;
  for (const f of files) {
    try {
      const r = convertOne(f, opt);
      ok++;
      console.log('✓ ' + path.basename(r.outPath));
      console.log(`   表单名: ${r.formName}   表单代码: ${r.formCode}${r.hospitalName ? '   医院: ' + r.hospitalName : ''}`);
      console.log(`   组件 ${r.components} 个  |  唯一字段 ${r.uniqueValues} 个（患者字段 ${r.patientCount}）  |  去重改名 ${r.dedup} 次`);
      console.log(`   类型分布: ${Object.entries(r.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '×' + v).join(', ')}`);
      console.log(`   内容高度 ${r.contentHeightCm.toFixed(1)}cm / 页高 ${r.pageHcm.toFixed(1)}cm  →  共 ${r.pageCount} 页，单页填充率 ${(r.fillRatio * 100).toFixed(0)}%`);
      if (r.unknown) console.log(`   ⚠ 未命中词典标签 ${r.unknown} 个 → 见 ${path.basename(r.outPath).replace(/\.json$/, '.unknown.txt')}`);
    } catch (e) {
      console.error('✗ ' + f + ' : ' + e.message);
      if (process.env.DEBUG) console.error(e.stack);
    }
  }
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = { convertOne, parseName, toCode };
