'use strict';
/**
 * form-builder.js — 语义原子 → 设计器组件 + 表格还原 + 顶层 JSON 装配
 *
 * 组件字段集严格对齐**设计器真实导出**的成品表单（testexam/患者入院护理评估表.json、ceshi json.json），
 * 避免"导入后属性面板空/渲染异常"。
 *
 * 单位：cm × 2.3622 = rem（设计器几何单位；1rem = 12pt，A4 宽 21cm = 49.6rem）
 *
 * 段落与表格单元格**共用同一条语义管线**（segmentize → toClauses → clausesToAtoms → emitAtom）：
 * 表格式文书里的"会诊原因：□A □B □C"同样要变成勾选题组，不能退化成一行纯文本。
 */

const { pt2cm, pt2rem } = require('./docx-reader');
const L = require('./layout');

const CM2REM = 10 * 0.23622;                  // 2.3622
const cm2rem = (cm) => Math.round(cm * CM2REM * 100) / 100;

let _idSeq = 0;
const newCompId = () => (Math.random().toString() + (++_idSeq)).slice(0, 20);
const newFormId = () => {
  const hex = '0123456789abcdef';
  let s = Math.floor(Date.now() / 1000).toString(16);
  while (s.length < 24) s += hex[Math.floor(Math.random() * 16)];
  return s.slice(0, 24);
};

/** 组件基线模板（字段集与顺序对齐设计器真实导出） */
function blank(type) {
  return {
    borderWidth: null, category: null, code: null,
    color: '#000000', customizeInput: null, dashArray: null,
    dataType: { format: null, type: null },
    defaultCheck: null, defaultContent: null,
    defaultLoginAccount: false, defaultSysTime: false,
    end: [], fontFamily: '宋体', fontSize: 0.94,
    fontStyle: null, fontWeight: null, format: null,
    height: 1.5, horiAlign: null,
    isFlexWrap: true, isNoBorder: null, justify: null,
    lineHeight: null, modalType: null, multiSelect: null,
    numberBox: false, optionSpace: 0.25, optionStr: ',',
    options: [], readonly: null, required: false,
    requiredAction: null, rotate: null, rows: [],
    score: null, shape: null, src: null, start: [],
    text: null, textAlign: null, textDecoration: null,
    textHoriAlign: null, textVertAlign: null,
    totalAcrossPages: false, type,
    value: null, vertAlign: null, width: null,
    x: 0, y: 0, zIndex: null,
    id: newCompId(), isSave: false, isFocus: false,
  };
}

/** 组件高度：= 字号（1em）。外壳会外扩约 1.6px，行高按 1.23 倍字号留出余量，刚好不压叠 */
function atomHeight(a, ctx) {
  const pt = a.sizePt || ctx.defaultSizePt;
  return Math.max(pt2cm(pt) * 1.0, 0.36);
}

// ================== 语义原子 → 组件 ==================
/**
 * @param a   原子（label / check / input / line）
 * @param x,y 绝对坐标（cm）
 * @returns 组件高度（cm）
 */
function emitAtom(a, x, y, ctx, opts = {}) {
  const out = ctx.out;
  const h = atomHeight(a, ctx);
  const fontSizeRem = pt2rem(a.sizePt || ctx.defaultSizePt);
  const align = opts.align || 'left';
  const vAlign = opts.valign || 'center';
  const xShift = opts.xShift || 0;

  if (a.kind === 'label') {
    const c = blank('label');
    Object.assign(c, {
      x: cm2rem(x + xShift), y: cm2rem(y), width: cm2rem(a.w), height: cm2rem(h),
      text: a.text, fontSize: fontSizeRem, value: null,
      textHoriAlign: align, textVertAlign: vAlign,
    });
    if (a.tone === 'strong' || a.bold) c.fontWeight = 'bolder';
    out.push(c);
  } else if (a.kind === 'check') {
    const c = blank('checkBox');
    Object.assign(c, {
      x: cm2rem(x + xShift), y: cm2rem(y), width: cm2rem(a.w), height: cm2rem(h),
      text: a.text, code: a.optionCode, value: a.fieldValue,
      fontSize: fontSizeRem, isSave: true,
      multiSelect: a.multiSelect || null,
      optionStr: ',', optionSpace: 0.25, isFlexWrap: true,
      textHoriAlign: align, textVertAlign: vAlign,
    });
    out.push(c);
  } else if (a.kind === 'input') {
    const type = a.inputType || 'textField';
    const c = blank(type);
    const isPatient = !!a.isPatient;
    let value = a.fieldValue;
    if (!value) {
      const base = a.fieldLabel || ctx.lastLabel || 'note';
      value = ctx.registry.fieldValue(`${base}内容`, { noPatient: true, silent: true }).value;
      a.isPatient = false;
    }
    Object.assign(c, {
      x: cm2rem(x + xShift), y: cm2rem(y), width: cm2rem(a.w), height: cm2rem(h),
      value, isSave: true, fontSize: fontSizeRem,
      readonly: isPatient ? true : null,
      textHoriAlign: align, textVertAlign: vAlign,
    });
    if (type === 'textField') {
      // ★ 下划线：df-text-field.getStyle() 里 borderBottomColor = isNoBorder===true ? 'transparent' : color
      //   即 isNoBorder:true 会把下划线**隐藏**（文档里"无边框（下划线式）"的表述容易误解）。
      //   要"带出下划线"必须 false —— 画布上才能一眼看出哪里是填写位。
      c.isNoBorder = false;
    } else if (type === 'select') {
      // 下拉框：options = [{label, value}]，结构取自设计器真实导出
      c.options = a.options || [];
      c.optionStr = ',';
      c.multiSelect = false;
      c.isNoBorder = null;
    } else if (type === 'ca-signature') {
      c.text = '签名';
      c.isNoBorder = false;
    } else if (type === 'modalDatePicker') {
      c.format = 'yyyy-MM-dd HH:mm';
      c.isNoBorder = false;
      c.defaultSysTime = true;
    }
    out.push(c);
  } else if (a.kind === 'line') {
    const c = blank('line');
    Object.assign(c, {
      x: cm2rem(x + xShift), y: cm2rem(y + h * 0.75), width: cm2rem(a.w), height: cm2rem(0.05),
      shape: 'solid', rotate: 0, value: null,
    });
    c.start = [0, 0];
    c.end = [cm2rem(a.w), 0];
    out.push(c);
  }
  return h;
}

/** 输出一整行原子 */
function emitRowAtoms(row, yAbs, ctx, opts = {}) {
  let x = (opts.x0 || 0);
  let h = 0;
  for (const a of row.atoms) {
    h = Math.max(h, emitAtom(a, x, yAbs, ctx, opts));
    x += a.w + L.CONST.GAP_CM;
  }
  return h;
}

// ================== 段落 ==================
function buildFromParagraph(para, ctx) {
  if (!para.runs.length) { ctx.cursorY += 0.3; return; }
  const segs = L.segmentize(para);
  if (!segs.length) { ctx.cursorY += 0.3; return; }

  // ===== 图片留位（放在段落**之前**）=====
  // Word 里锚定在本段的浮动大图（如"疼痛评分量表" 18.74×5.84cm）在版式上压在本段上方/左侧，
  // 故先让出高度，再排本段文字，顺序才与原 Word 一致。
  // 小图（如 1.93×1.86cm 的照片/logo）不占位，避免把标题挤散。
  for (const img of (para.images || [])) {
    const big = img.wCm >= 8 || (img.wCm * img.hCm) >= 20;
    if (big) {
      ctx.cursorY += img.hCm + 0.15;
      ctx.imageCm = (ctx.imageCm || 0) + img.hCm;
      if (process.env.DBG) console.error(`[img留位] +${img.hCm}cm → cursorY=${ctx.cursorY.toFixed(2)}  段="${(para.plainText || '').replace(/\s+/g, '').slice(0, 18)}"`);
    }
  }

  const clauses = L.toClauses(segs);
  const semantics = L.clausesToAtoms(clauses, ctx.registry, { defaultSizePt: para.sizePt, lastLabel: ctx.lastLabel });
  let atoms = semantics.atoms;
  if (semantics.lastLabel) ctx.lastLabel = semantics.lastLabel;
  if (!atoms.length) { ctx.cursorY += 0.2; return; }

  // 段前/段后距按 0.5 折算：Word 段间距偏松，折算后整表更贴合 A4
  ctx.cursorY += para.spaceBeforeCm * 0.35;

  const indentX = Math.max(0, para.indentLeftCm - para.hangingCm) + (para.firstLineCm || 0);
  const availW = Math.max(2, ctx.usableW - indentX - para.indentRightCm);

  const inputCount = atoms.filter((a) => a.kind === 'input').length;
  const patientCount = atoms.filter((a) => a.isPatient).length;
  if (inputCount >= 3 && patientCount >= 2) atoms = L.stretchPatientRow(atoms, availW);

  const totalW = atoms.reduce((s, a) => s + a.w + L.CONST.GAP_CM, 0);
  const isTitle = atoms.length === 1 && atoms[0].kind === 'label'
    && para.align === 'center' && para.runs.every((r) => !r.underline)
    && para.plainText.trim().length <= 30;

  let rows, x0 = indentX;
  if (isTitle) {
    x0 = Math.max(0, (ctx.usableW - atoms[0].w) / 2);
    atoms[0].bold = true;
    rows = [{ atoms, h: pt2cm(para.sizePt) * 1.9, y: 0 }];
  } else if (para.align === 'center') {
    x0 = Math.max(0, indentX + (availW - totalW) / 2);
    rows = L.layoutRows(atoms, availW, { startX: x0 });
  } else if (para.align === 'right') {
    x0 = Math.max(0, indentX + (availW - totalW));
    rows = L.layoutRows(atoms, availW, { startX: x0 });
  } else {
    rows = L.layoutRows(atoms, availW, { startX: x0 });
  }

  // ★ row.y 是段内偏移，必须用段落基准 y；同时在循环内累加 cursorY 会双重计入
  const paraY0 = ctx.cursorY;
  let rowsTotalH = 0;
  for (const row of rows) {
    let x = row.x0 != null ? row.x0 : x0;
    for (const a of row.atoms) {
      emitAtom(a, x, paraY0 + (row.y || 0), ctx);
      x += a.w + L.CONST.GAP_CM;
    }
    rowsTotalH += row.h;
  }
  ctx.cursorY = paraY0 + rowsTotalH + para.spaceAfterCm * 0.35;
}

// ================== 表格 ==================
/** 规划单元格内容（不输出，先量高度） */
function planCell(paras, availW, ctx, inheritLabel) {
  const plan = [];
  let lastLabel = inheritLabel;
  let y = 0;
  for (const para of paras) {
    const segs = L.segmentize(para);
    if (!segs.length) { y += pt2cm(para.sizePt) * 1.4; continue; }
    const clauses = L.toClauses(segs);
    const sem = L.clausesToAtoms(clauses, ctx.registry, { defaultSizePt: para.sizePt, lastLabel });
    if (sem.lastLabel) lastLabel = sem.lastLabel;
    if (!sem.atoms.length) { y += pt2cm(para.sizePt) * 1.4; continue; }
    const rows = L.layoutRows(sem.atoms, Math.max(0.6, availW), { startX: 0 });
    for (const r of rows) plan.push({ atoms: r.atoms, y: y + (r.y || 0), h: r.h });
    y += rows.reduce((s, r) => s + r.h, 0);
  }
  return { plan, heightCm: y, lastLabel };
}

function buildFromTable(tbl, ctx) {
  const usableW = ctx.usableW;
  let colsCm = tbl.colsCm.slice();
  let totalW = colsCm.reduce((a, b) => a + b, 0);
  if (!colsCm.length) return;
  // 超宽 → 缩到内容区；宽度已达内容区 70% 以上 → 等比放大到满宽（列宽比例不变），尽量填满 A4
  if (totalW >= usableW * 0.7 && Math.abs(totalW - usableW) > 0.01) {
    const k = usableW / totalW;
    colsCm = colsCm.map((c) => c * k);
    totalW = usableW;
  }
  ctx.cursorY += 0.15;
  const pad = 0.14;
  const sizePt = ctx.defaultSizePt;
  const yTableTop = ctx.cursorY;
  const rowInfos = [];          // 记录每行的 y/h，循环结束后统一用 line 画表格线

  tbl.rows.forEach((row, ri) => {
    // ---- 第一遍：规划每个单元格 ----
    const cellPlans = [];
    let gi = 0;
    for (const cell of row.cells) {
      const w = colsCm.slice(gi, gi + cell.span).reduce((a, b) => a + b, 0);
      const text = cell.paras.map((p) => p.plainText).join('').trim();
      const needsSemantics = /[□☐]/.test(text) || cell.paras.some((p) => p.runs.some((r) => r.underline && /^\s+$/.test(r.text)));
      if (!text && !needsSemantics) {
        cellPlans.push({ w, kind: 'empty' });
      } else if (!needsSemantics) {
        cellPlans.push({ w, kind: 'text', text, heightCm: pt2cm(sizePt) * 1.4 });
      } else {
        const p = planCell(cell.paras, w - pad * 2, ctx, ctx.lastLabel);
        cellPlans.push({ w, kind: 'rich', plan: p.plan, heightCm: p.heightCm, lastLabel: p.lastLabel });
      }
      gi += cell.span;
    }

    const contentH = cellPlans.reduce((m, c) => Math.max(m, c.heightCm || 0), 0);
    // 纵向填满 A4 时给每行加高（ctx.tableRowExtraCm），表格线保持连续
    const rowH = Math.max(row.heightCm || 0, contentH + pad * 2, 0.62) + (ctx.tableRowExtraCm || 0);
    const yTop = ctx.cursorY;

    // 表格线不再用 table 组件（设计器会给它贴一个 "table" 图标，编辑态很碍眼），
    // 统一在本函数末尾用 line 组件画（见下方"画表格线"）。

    // ---- 单元格内容 ----
    const isHeaderRow = ri === 0;
    const rowHasText = cellPlans.some((c) => c.kind === 'text' || c.kind === 'rich');
    const rowLabel = (row.cells[0] && row.cells[0].paras.length)
      ? row.cells[0].paras.map((p) => p.plainText).join('').trim() : '';

    let cx = 0;
    for (let ci = 0; ci < cellPlans.length; ci++) {
      const cp = cellPlans[ci];
      if (cp.kind === 'text') {
        // 单元格内文字：宽度尽量占满单元格，放不下就等比缩字号
        // （否则"呼吸（次/分）"这类 6 字标签在 2.5cm 列里会被迫换行）
        const availW = cp.w - 0.06;
        const needW = L.textWidthCm(cp.text, sizePt);
        let fontPt = sizePt;
        if (needW > availW) fontPt = Math.max(8, sizePt * (availW / needW) * 0.98);
        const h = Math.min(rowH - 0.08, pt2cm(fontPt) * 1.5);
        const c = blank('label');
        Object.assign(c, {
          x: cm2rem(cx + 0.03), y: cm2rem(yTop + (rowH - h) / 2),
          width: cm2rem(availW), height: cm2rem(h),
          text: cp.text, fontSize: pt2rem(fontPt), value: null,
          textHoriAlign: (ci === 0 && !isHeaderRow) ? 'left' : 'center',
          textVertAlign: 'center',
        });
        ctx.out.push(c);
      } else if (cp.kind === 'rich') {
        const offset = Math.max(0, (rowH - cp.heightCm) / 2);
        for (const rowPlan of cp.plan) {
          let x = cx + pad;
          for (const a of rowPlan.atoms) {
            emitAtom(a, x, yTop + offset + rowPlan.y, ctx);
            x += a.w + L.CONST.GAP_CM;
          }
        }
        if (cp.lastLabel) ctx.lastLabel = cp.lastLabel;
      } else if (!isHeaderRow && rowHasText && cp.w >= 1.0) {
        // 数据行的空格子 → 可填字段（字段名 = 行标签 + 列号）
        // 宽度 < 1cm 的窄列通常是"竖排标签列/装饰列"，不生成输入框，避免产生无意义字段
        const v = ctx.registry.fieldValue(`${rowLabel || 'table'}${ci + 1}`, { noPatient: true, silent: true });
        const c = blank('textField');
        const h = Math.min(rowH - pad, pt2cm(sizePt) * 1.5);
        Object.assign(c, {
          x: cm2rem(cx + pad), y: cm2rem(yTop + (rowH - h) / 2),
          width: cm2rem(cp.w - pad * 2), height: cm2rem(h),
          value: v.value, isSave: true, fontSize: pt2rem(sizePt),
          isNoBorder: false, numberBox: false,
          textHoriAlign: 'center', textVertAlign: 'center',
        });
        ctx.out.push(c);
      }
      cx += cp.w;
    }

    rowInfos.push({ y: yTop, h: rowH });
    ctx.cursorY = yTop + rowH;
  });

  // ===== 画表格线（全部用 line 组件，不用 table 组件）=====
  // df-line 源码：width=线长；height=borderTopWidth=线粗；transform: rotate(Xdeg) 绕**元素中心**旋转。
  // 故竖线必须补偿：x = 目标x - 线长/2，y = 中心y - 线粗/2。
  const tableH = ctx.cursorY - yTableTop;
  const LINE_T = 0.02;                 // 线粗 0.02cm ≈ 0.57pt，接近 Word 表格线
  const pushLine = (lx, ly, lenCm, thickCm, rot) => {
    const c = blank('line');
    Object.assign(c, {
      x: cm2rem(lx), y: cm2rem(ly), width: cm2rem(lenCm), height: cm2rem(thickCm),
      shape: 'solid', color: '#000000', rotate: rot || 0, value: null, fontSize: pt2rem(sizePt),
    });
    ctx.out.push(c);
  };
  pushLine(0, yTableTop, totalW, LINE_T, 0);                                    // 表顶横线
  rowInfos.forEach((r) => pushLine(0, r.y + r.h, totalW, LINE_T, 0));           // 每行底横线
  let vx = 0;
  for (let j = 0; j <= colsCm.length; j++) {                                    // 竖线（含左右外框）
    pushLine(vx - tableH / 2, yTableTop + tableH / 2 - LINE_T / 2, tableH, LINE_T, 90);
    if (j < colsCm.length) vx += colsCm[j];
  }

  ctx.cursorY += 0.15;
}

/**
 * 列对齐 —— 把"结构相同的连续行"按列对齐。
 * 原 Word 里"三、术前检查"下的 6 行（血常规/凝血常规/电解质/肝功能/肾功能/ECG）
 * 标签、勾选框、下划线是**列对齐**的（Word 用分散对齐做到）。逐行独立排的话每行都会错位。
 */
function alignColumnGroups(comps) {
  const GAP = L.CONST.GAP_CM * CM2REM;
  // ★ 表格线（line/rect/table）不参与列对齐：
  //   表格行的首个组件是 line（宽=整表宽 19.7cm），若把它当第一列，
  //   列宽会被撑成 19.7cm，行标签就被推到表格外面（现象：表格右侧出现一个竖排小字）。
  const sorted = comps.slice()
    .filter((c) => c.type !== 'line' && c.type !== 'rect' && c.type !== 'table')
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const rows = [];
  for (const c of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(c.y - last.y) <= 0.35) last.items.push(c);
    else rows.push({ y: c.y, items: [c] });
  }

  // 找"连续且结构相同"的行组（类型序列一致）
  const groups = [];
  let cur = [];
  let lastSig = null;
  for (const r of rows) {
    const sig = r.items.map((c) => c.type).join('|');
    if (sig === lastSig && r.items.length >= 3) cur.push(r);
    else {
      if (cur.length >= 2) groups.push(cur);
      cur = [r];
      lastSig = sig;
    }
  }
  if (cur.length >= 2) groups.push(cur);

  let alignedRows = 0;
  for (const g of groups) {
    const n = Math.max(...g.map((r) => r.items.length));
    if (n < 3) continue;
    // 每列取该列最宽的组件宽度
    const colW = [];
    for (let i = 0; i < n; i++) {
      colW[i] = Math.max(...g.map((r) => (r.items[i] ? (r.items[i].width || 0) : 0)));
    }
    for (const r of g) {
      let x = r.items[0].x;
      for (let i = 0; i < r.items.length; i++) {
        const it = r.items[i];
        it.x = Math.round(x * 100) / 100;
        // 最后一列（输入框）不再按列宽推进，避免整行超宽
        x += (i === r.items.length - 1 ? (it.width || 0) : colW[i]) + GAP;
      }
    }
    alignedRows += g.length;
  }
  return alignedRows;
}

// ================== 主流程 ==================
/** 单遍生成：把整份文档排成组件 */
function runPass(model, registry, passOpts = {}) {
  const ctx = {
    out: [],
    registry,
    usableW: model.page.usableWcm,
    cursorY: 0,
    defaultSizePt: model.defaultSizePt,
    lastLabel: '',
    tableRowExtraCm: passOpts.tableRowExtraCm || 0,
  };
  let blockCount = 0;
  let tableRows = 0;
  for (const block of model.blocks) {
    const before = ctx.out.length;
    if (block.kind === 'para') buildFromParagraph(block, ctx);
    else { tableRows += (block.rows || []).length; buildFromTable(block, ctx); }
    // 打"文档块"标记：一个 docx 段落 = 一块，一张 docx 表格 = 一块（整表一起平移，表格线不会断）
    for (let i = before; i < ctx.out.length; i++) ctx.out[i]._block = blockCount;
    blockCount += 1;
  }
  return { components: ctx.out, blockCount, tableRows, contentH: ctx.cursorY };
}

function buildComponents(model, registry, opts = {}) {
  // 第一遍：测量
  let pass = runPass(model, registry, {});

  // ===== 列对齐（"三、术前检查"那类同构行，原 Word 是列对齐的）=====
  const alignedRows = alignColumnGroups(pass.components);

  // ===== 纵向填满 A4 =====
  // 内容不足一页时补足高度。优先**拉伸表格行高**（表格线连续，不会被拉断），
  // 仍有缺口再按"文档块间隙"摊开（块内相对位置不变）。分两遍是为了字段名保持一致。
  const usableH = model.page.hCm - 1.0;          // 上下各 5mm 页边距
  const targetH = usableH - 0.2;                 // 组件外壳会外扩约 1.6px，占满会竖向溢出
  if (opts.fillPage !== false && pass.blockCount > 1 && pass.contentH > 1 && pass.contentH < targetH * 0.985) {
    const deficit = targetH - pass.contentH;
    const rowExtra = pass.tableRows > 0 ? Math.min(deficit / pass.tableRows, 0.3) : 0;
    if (rowExtra > 0.005) {
      registry.reset();                          // 两遍的字段名必须一致
      pass = runPass(model, registry, { tableRowExtraCm: rowExtra });
    }
    const deficit2 = targetH - pass.contentH;
    if (deficit2 > 0.05 && pass.blockCount > 1) {
      // 按"每个块间隙最多 0.35cm"限幅：块多的长文书能填满，块少的也不会散架
      const perGap = Math.min(deficit2 / (pass.blockCount - 1), 0.35);
      for (const c of pass.components) {
        const b = c._block || 0;
        if (b > 0) c.y = Math.round((c.y + b * perGap * CM2REM) * 100) / 100;
      }
      pass.contentH += perGap * (pass.blockCount - 1);
    }
  }

  // ===== 分页：内容超一页时按"文档块"拆页（表格不会被劈开）=====
  const pageHcm = model.page.hCm - 1.0;
  let pages = null;
  if (pass.contentH > pageHcm * 1.002) {
    pages = paginateByBlock(pass.components, pageHcm);
  }

  // 清理内部标记 + 严格对齐设计器真实导出（纯展示类组件不带 isSave）
  // （文档明确记载后端对 table 的多余键敏感，会抛"未知异常"）
  const all = pages ? pages.flat() : pass.components;
  for (const c of all) {
    delete c._block;
    if (c.type === 'label' || c.type === 'table' || c.type === 'line' || c.type === 'rect') delete c.isSave;
  }
  return {
    components: pass.components,
    pages,
    pageCount: pages ? pages.length : 1,
    contentHeightCm: pass.contentH,
  };
}

/**
 * 按"文档块"分页：整块不可拆
 * （一个 docx 段落 = 一块，一张 docx 表格 = 一块 → 表格永远不会被劈到两页）
 * @returns [{components}] 每页一组（y 已归零到本页）
 */
function paginateByBlock(comps, pageHcm) {
  const pageH = cm2rem(pageHcm);
  const groups = [];
  for (const c of comps) {
    const b = c._block || 0;
    let g = groups[groups.length - 1];
    if (!g || g.block !== b) { g = { block: b, items: [] }; groups.push(g); }
    g.items.push(c);
  }
  const pages = [];
  let cur = [];
  let offset = 0;
  for (const g of groups) {
    const top = Math.min(...g.items.map((c) => c.y));
    const bottom = Math.max(...g.items.map((c) => c.y + (c.height || 0)));
    if (cur.length && (bottom - offset) > pageH) {
      pages.push(cur);
      cur = [];
      offset = top;
    }
    for (const c of g.items) {
      cur.push(Object.assign({}, c, { y: Math.round((c.y - offset) * 100) / 100 }));
    }
  }
  if (cur.length) pages.push(cur);
  return pages;
}

/** 组装顶层 JSON（设计器"导入 json 文件"读取的结构） */
function assemble({ formName, formCode, components, layout = 'vertical', pages = null, paddingMm = 5 }) {  return {
    code: formCode,
    formName,
    formHasTime: false,
    hasData: false,
    id: newFormId(),
    layout,
    moduleId: 'form-customize',
    paddingBottom: paddingMm,
    paddingLeft: paddingMm,
    paddingRight: paddingMm,
    paddingTop: paddingMm,
    // 设计器的 pages 结构是 [{components:[...]}, ...]；分页结果传进来的是"每页一个组件数组"，这里统一
    pages: (Array.isArray(pages) && pages.length)
      ? pages.map((p) => (Array.isArray(p) ? { components: p } : p))
      : [{ components }],
    requiredType: null,
    showTimeNextRow: false,
    showUnderLine: true,
    size: 'A4',
    valid: null,
  };
}

module.exports = {
  buildComponents, assemble, blank,
  emitAtom, emitRowAtoms, planCell,
  cm2rem, CM2REM,
};
