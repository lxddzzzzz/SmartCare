'use strict';
/**
 * docx-reader.js — 把 .docx 解析成"保序的中间模型"
 *
 * 单位约定（全程 cm / pt，最后输出时才转 rem）：
 *   docx 内部：dxa(=twips, 1/20 pt)、w:sz(半磅)
 *   1 inch = 1440 dxa = 2.54 cm
 *   1 pt = 1/72 inch
 *   设计器：1 rem = 12 pt = 4.2333 mm（由成品表单 fontSize=1 ↔ UI 字号 16 及 A4=49.6rem 交叉验证）
 *
 * 关键修正（相对既有工具链）：
 *   1. **顶层块保序**：段落与表格按 document.xml 中真实先后顺序输出。
 *      既有实现按对象键遍历（先所有 w:p 再所有 w:tbl），表格在文末时才侥幸正确，
 *      一旦"段-表-段"交错就会整体错位。
 *   2. 完整读取段落几何：对齐、缩进(左/右/首行/悬挂)、段前段后距、行距规则。
 *   3. 字号三级回退：run w:sz → 段落样式 → Normal 默认(21 半磅)。
 */

const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');

const DXA_PER_CM = 1440 / 2.54;        // 566.9291
const EMU_PER_CM = 360000;             // 1 cm = 360000 EMU（图片尺寸/定位）
const PT_PER_REM = 12;                 // 1 rem = 12 pt
const PT_PER_CM = 72 / 2.54;           // 28.3465

const dxa2cm = (d) => Number(d) / DXA_PER_CM;
const halfPt2pt = (s) => Number(s) / 2;
const pt2cm = (pt) => pt / PT_PER_CM;
/** 字号 pt → 设计器字号 rem */
const pt2rem = (pt) => pt / PT_PER_REM;

const arr = (v) => (Array.isArray(v) ? v : (v == null ? [] : [v]));

/** 取 w:t 节点的文本（可能是 {'#text':..} 形式） */
function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object') {
    if (node['#text'] != null) return String(node['#text']);
    return '';
  }
  return String(node);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
});

/**
 * 从原始 XML 中按出现顺序切出 body 的顶层块。
 * 返回 [{tag:'p'|'tbl', index:n}]，index 是在同类数组中的下标。
 * 说明：顶层 w:p 不嵌套 w:p；顶层 w:tbl 内才含 w:p，用非贪婪配对即可。
 */
function scanTopLevelOrder(bodyXml) {
  const re = /<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const out = [];
  let m;
  const counter = { p: 0, tbl: 0 };
  while ((m = re.exec(bodyXml)) !== null) {
    const isTbl = m[0].startsWith('<w:tbl');
    const tag = isTbl ? 'tbl' : 'p';
    out.push({ tag, index: counter[tag]++ });
  }
  return out;
}

function readDefaultSizePt(stylesXml) {
  try {
    const s = parser.parse(stylesXml);
    const styles = arr(s['w:styles'] && s['w:styles']['w:style']);
    const normal =
      styles.find((x) => x['@_w:default'] === '1' && x['@_w:type'] === 'paragraph') ||
      styles.find((x) => x['@_w:styleId'] === 'a') ||
      styles.find((x) => (x['w:name'] || {})['@_w:val'] === 'Normal');
    const sz = normal && normal['w:rPr'] && normal['w:rPr']['w:sz'];
    if (sz && sz['@_w:val']) return halfPt2pt(sz['@_w:val']);
  } catch (e) { /* 忽略 */ }
  return 10.5; // Word 默认五号
}

/** 解析一个 run */
function parseRun(r, inheritSizePt) {
  const rPr = r['w:rPr'] || {};
  let text = textOf(r['w:t']);
  // 制表符 / 换行
  const tabs = arr(r['w:tab']).length;
  const brs = arr(r['w:br']).length;
  if (tabs) text += '\t'.repeat(tabs);
  if (brs) text += '\n'.repeat(brs);

  const uNode = rPr['w:u'];
  const underline = !!(uNode && uNode['@_w:val'] && uNode['@_w:val'] !== 'none');
  const sizePt = rPr['w:sz'] && rPr['w:sz']['@_w:val']
    ? halfPt2pt(rPr['w:sz']['@_w:val'])
    : inheritSizePt;
  const bold = !!(rPr['w:b'] && (rPr['w:b']['@_w:val'] == null || rPr['w:b']['@_w:val'] !== '0'));
  const shdFill = rPr['w:shd'] ? rPr['w:shd']['@_w:fill'] : null;
  const shaded = !!(shdFill && shdFill !== 'auto' && shdFill.toLowerCase() !== 'ffffff');
  const fontNode = rPr['w:rFonts'] || {};
  const font = fontNode['@_w:eastAsia'] || fontNode['@_w:ascii'] || null;

  return { text, underline, sizePt, bold, shaded, font, shdFill };
}

/** 解析段落几何 + runs */
function parseParagraph(p, defaultSizePt) {
  const pPr = p['w:pPr'] || {};
  const jcNode = pPr['w:jc'];
  const jc = jcNode ? jcNode['@_w:val'] : null;

  // 自动编号：Word 的"四、"这类编号**不在 w:t 里**，只存 numPr 引用，
  // 渲染时才由 Word 生成。不解析它就会整段丢掉大类名（本档的"四、麻醉方法"就是这么丢的）。
  let numPr = null;
  if (pPr['w:numPr']) {
    const np = pPr['w:numPr'];
    numPr = {
      numId: np['w:numId'] ? np['w:numId']['@_w:val'] : null,
      ilvl: np['w:ilvl'] ? np['w:ilvl']['@_w:val'] : '0',
    };
  }

  const ind = pPr['w:ind'] || {};
  const leftCm = ind['@_w:left'] ? dxa2cm(ind['@_w:left']) : 0;
  const rightCm = ind['@_w:right'] ? dxa2cm(ind['@_w:right']) : 0;
  const hangingCm = ind['@_w:hanging'] ? dxa2cm(ind['@_w:hanging']) : 0;
  let firstLineCm = ind['@_w:firstLine'] ? dxa2cm(ind['@_w:firstLine']) : 0;
  if (!firstLineCm && ind['@_w:firstLineChars']) firstLineCm = 0; // 由字号另行折算

  const sp = pPr['w:spacing'] || {};
  const beforeCm = sp['@_w:before'] ? dxa2cm(sp['@_w:before']) : 0;
  const afterCm = sp['@_w:after'] ? dxa2cm(sp['@_w:after']) : 0;
  const lineRule = sp['@_w:lineRule'] || 'auto';
  const lineVal = sp['@_w:line'] ? Number(sp['@_w:line']) : 0;

  const runs = arr(p['w:r']).map((r) => parseRun(r, defaultSizePt)).filter((r) => r.text !== '' || r.underline);
  const maxSizePt = runs.length ? Math.max(...runs.map((r) => r.sizePt)) : defaultSizePt;

  // ===== 图片（浮动图形）：记录尺寸，用于在版式里"留出空位" =====
  // 本文书用的是 wp:anchor 浮动图（照片 logo 1.93×1.86cm、疼痛评分量表 18.74×5.84cm）
  const images = [];
  for (const r of arr(p['w:r'])) {
    for (const d of arr(r['w:drawing'])) {
      const anchor = d['wp:anchor'] || d['wp:inline'];
      if (!anchor) continue;
      const ext = anchor['wp:extent'] || {};
      const wCm = Number(ext['@_cx'] || 0) / EMU_PER_CM;
      const hCm = Number(ext['@_cy'] || 0) / EMU_PER_CM;
      if (wCm <= 0.1 || hCm <= 0.1) continue;
      const docPr = anchor['wp:docPr'] || {};
      images.push({
        wCm: Math.round(wCm * 100) / 100,
        hCm: Math.round(hCm * 100) / 100,
        descr: docPr['@_descr'] || docPr['@_name'] || '图片',
      });
    }
  }

  // 行距 → 倍数 / 固定高度(cm)
  let lineMultiple = 1.25;
  let lineExactCm = null;
  if (lineVal > 0) {
    if (lineRule === 'auto') lineMultiple = lineVal / 240;
    else if (lineRule === 'exact') lineExactCm = dxa2cm(lineVal);
    else if (lineRule === 'atLeast') {
      const c = dxa2cm(lineVal);
      if (c > pt2cm(maxSizePt) * 0.9) lineExactCm = c; // 明显小于字号则视为无效值
    }
  }

  return {
    kind: 'para',
    align: jc === 'center' ? 'center' : (jc === 'right' ? 'right' : 'left'),
    indentLeftCm: leftCm,
    indentRightCm: rightCm,
    firstLineCm,
    hangingCm,
    spaceBeforeCm: beforeCm,
    spaceAfterCm: afterCm,
    lineMultiple,
    lineExactCm,
    sizePt: maxSizePt,
    runs,
    images,
    numPr,
    plainText: runs.map((r) => r.text).join(''),
  };
}

/** 解析表格 */
function parseTable(tbl, defaultSizePt) {
  const gridNode = (tbl['w:tblGrid'] || {})['w:gridCol'];
  const colDxa = arr(gridNode).map((g) => Number(g['@_w:w'])).filter((n) => n > 0);
  const colsCm = colDxa.map(dxa2cm);

  const rows = arr(tbl['w:tr']).map((tr) => {
    const trPr = tr['w:trPr'] || {};
    const trH = trPr['w:trHeight'];
    const heightCm = trH && trH['@_w:val'] ? dxa2cm(trH['@_w:val']) : null;
    const hRule = trH ? (trH['@_w:hRule'] || 'auto') : 'auto';

    const cells = arr(tr['w:tc']).map((tc) => {
      const tcPr = tc['w:tcPr'] || {};
      const span = tcPr['w:gridSpan'] ? Number(tcPr['w:gridSpan']['@_w:val']) : 1;
      const vMergeNode = tcPr['w:vMerge'];
      let vMerge = null;
      if (vMergeNode) {
        const val = vMergeNode['@_w:val'];
        vMerge = (!val || val === 'restart') ? 'restart' : 'continue';
      }
      const paras = arr(tc['w:p'])
        .map((p) => parseParagraph(p, defaultSizePt))
        .filter((p) => p.plainText.trim() !== '' || p.runs.some((r) => r.underline));
      return { span, vMerge, paras };
    });

    return { heightCm, hRule, cells };
  });

  return { kind: 'table', colsCm, rows, totalWcm: colsCm.reduce((a, b) => a + b, 0) };
}

/**
 * 主入口：解析 .docx
 * @returns {{page:object, defaultSizePt:number, blocks:Array}}
 */
// =================== Word 自动编号（numbering.xml）===================
const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 数字 → 指定格式的编号文本 */
function fmtNumber(n, numFmt) {
  const v = Number(n) || 1;
  if (numFmt === 'chineseCounting' || numFmt === 'chineseCountingThousand' || numFmt === 'ideographDigital') {
    if (v <= 10) return v === 10 ? '十' : CN_DIGITS[v];
    if (v < 20) return '十' + CN_DIGITS[v - 10];
    if (v < 100) return CN_DIGITS[Math.floor(v / 10)] + '十' + (v % 10 ? CN_DIGITS[v % 10] : '');
    return String(v);
  }
  if (numFmt === 'lowerLetter') return String.fromCharCode(96 + ((v - 1) % 26) + 1);
  if (numFmt === 'upperLetter') return String.fromCharCode(64 + ((v - 1) % 26) + 1);
  return String(v);
}

/** 解析 word/numbering.xml → { numId: { ilvl: {start, numFmt, lvlText} } } */
function parseNumbering(numberingXml) {
  const map = {};
  if (!numberingXml) return map;
  try {
    const doc = parser.parse(numberingXml);
    const root = doc['w:numbering'] || {};
    const absMap = {};
    for (const a of arr(root['w:abstractNum'])) {
      const id = a['@_w:abstractNumId'];
      const lvls = {};
      for (const lvl of arr(a['w:lvl'])) {
        const ilvl = lvl['@_w:ilvl'];
        lvls[ilvl] = {
          start: lvl['w:start'] ? Number(lvl['w:start']['@_w:val']) : 1,
          numFmt: lvl['w:numFmt'] ? lvl['w:numFmt']['@_w:val'] : 'decimal',
          lvlText: lvl['w:lvlText'] ? lvl['w:lvlText']['@_w:val'] : '%1.',
        };
      }
      absMap[id] = lvls;
    }
    for (const n of arr(root['w:num'])) {
      const numId = n['@_w:numId'];
      const absId = n['w:abstractNumId'] ? n['w:abstractNumId']['@_w:val'] : null;
      if (absId != null && absMap[absId]) map[numId] = absMap[absId];
    }
  } catch (e) { /* 忽略 */ }
  return map;
}

/** 把自动编号补进段落文本与首 run（编号不在 w:t 里，必须靠 numbering.xml 还原） */
function applyNumbering(paras, numbering, counters) {
  for (const b of paras) {
    if (!b || b.kind !== 'para' || !b.numPr) continue;
    const lvls = numbering[b.numPr.numId];
    const lvl = lvls ? lvls[b.numPr.ilvl] : null;
    if (!lvl) continue;
    const key = `${b.numPr.numId}:${b.numPr.ilvl}`;
    counters[key] = counters[key] != null ? counters[key] + 1 : lvl.start;
    const txt = String(lvl.lvlText || '%1').replace(/%\d/g, fmtNumber(counters[key], lvl.numFmt));
    b.runs.unshift({ text: txt, underline: false, sizePt: b.sizePt, bold: false, shaded: false, font: null });
    b.plainText = txt + b.plainText;
  }
}

function readDocx(docxPath) {
  const zip = new AdmZip(docxPath);
  const docXml = zip.readAsText('word/document.xml');
  let stylesXml = '';
  try { stylesXml = zip.readAsText('word/styles.xml'); } catch (e) { /* 无 */ }

  const defaultSizePt = readDefaultSizePt(stylesXml);

  const doc = parser.parse(docXml);
  const body = doc['w:document']['w:body'];

  // 页面设置：取第一个 sectPr（正文页面），并兼容 pgSz 的横向 orient
  const sectPrs = arr(body['w:sectPr']);
  let pgW = 11906, pgH = 16838;                                   // A4 纵向(dxa)
  let margin = { top: 1440, right: 720, bottom: 1440, left: 720 };
  if (sectPrs.length) {
    const sp = sectPrs[0];
    if (sp['w:pgSz']) {
      pgW = Number(sp['w:pgSz']['@_w:w']) || pgW;
      pgH = Number(sp['w:pgSz']['@_w:h']) || pgH;
      if (sp['w:pgSz']['@_w:orient'] === 'landscape' && pgW < pgH) { const t = pgW; pgW = pgH; pgH = t; }
    }
    if (sp['w:pgMar']) {
      const m = sp['w:pgMar'];
      margin = {
        top: Number(m['@_w:top'] || margin.top),
        right: Number(m['@_w:right'] || margin.right),
        bottom: Number(m['@_w:bottom'] || margin.bottom),
        left: Number(m['@_w:left'] || margin.left),
      };
    }
  }

  const page = {
    wCm: dxa2cm(pgW),
    hCm: dxa2cm(pgH),
    marginCm: {
      top: dxa2cm(margin.top), right: dxa2cm(margin.right),
      bottom: dxa2cm(margin.bottom), left: dxa2cm(margin.left),
    },
  };
  page.usableWcm = page.wCm - page.marginCm.left - page.marginCm.right;
  page.usableHcm = page.hCm - page.marginCm.top - page.marginCm.bottom;

  // ===== 保序拼装顶层块 =====
  const bodyXml = docXml.slice(docXml.indexOf('<w:body'));
  const order = scanTopLevelOrder(bodyXml);
  const pList = arr(body['w:p']);
  const tblList = arr(body['w:tbl']);

  const blocks = [];
  for (const o of order) {
    if (o.tag === 'p') {
      const p = pList[o.index];
      if (p) blocks.push(parseParagraph(p, defaultSizePt));
    } else {
      const t = tblList[o.index];
      if (t) blocks.push(parseTable(t, defaultSizePt));
    }
  }

  // 兜底：若扫描失败（例如 body 结构异常），退回对象遍历
  if (!blocks.length) {
    for (const p of pList) blocks.push(parseParagraph(p, defaultSizePt));
    for (const t of tblList) blocks.push(parseTable(t, defaultSizePt));
  }

  // ===== 补 Word 自动编号（"四、"这类编号不在文本里）=====
  let numberingXml = '';
  try { numberingXml = zip.readAsText('word/numbering.xml'); } catch (e) { /* 无 */ }
  const numbering = parseNumbering(numberingXml);
  const numCounters = {};
  applyNumbering(blocks, numbering, numCounters);                       // 顶层段落
  for (const b of blocks) {
    if (b.kind !== 'table') continue;
    for (const row of (b.rows || [])) {
      for (const cell of (row.cells || [])) applyNumbering(cell.paras, numbering, numCounters);   // 单元格内段落
    }
  }

  return { page, defaultSizePt, blocks, orientation: page.wCm > page.hCm ? 'horizontal' : 'vertical' };
}

module.exports = {
  readDocx,
  // 供其它模块复用的换算与工具
  dxa2cm, pt2cm, pt2rem, halfPt2pt,
  DXA_PER_CM, PT_PER_REM, PT_PER_CM,
  textOf, arr,
};
