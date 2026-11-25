'use strict';
/**
 * layout.js — 把 docx 中间模型排布成设计器组件（坐标单位 cm，最终由 form-builder 转 rem）
 *
 * 本文件是整个转换器的"语义核心"，解决三个既有实现的硬伤：
 *
 *  ① □ 勾选丢失/重叠
 *     旧做法：先把 □ 画成 label，再用"右侧 0.3~1.0cm 内是否有 label"事后配对。
 *     实测 45 个 □ 只配上 3 个，且配对成功的那 3 个还留下重复 label，与原框 100% 重叠。
 *     现做法：**先做语义切分（token → clause），再一次性产出 checkBox**，不存在配对失败。
 *
 *  ② 标签粘连（"否    双下肢活动"被当成一个选项）
 *     原因：中文表单常用"连续空白 + 无冒号"分隔字段（"姓名　　　性别"）。
 *     现做法：tokenize 阶段按"最后一个空白段"把文本拆成 head(前一段的尾巴) + tail(新标签)。
 *
 *  ③ 题组撞名（旧实现 value 恒为 chk.check.<文本>，跨题组同名直接冲突）
 *     现做法：题组名取自"标签："（如 过敏史 / 特殊用药史 / 脊柱异常），
 *     并全局唯一化；同一题组的多个 checkBox **共享 value**、各自 code = 选项，与真实成品表单一致。
 */

const { pt2cm } = require('./docx-reader');

// ===== 常量 =====
const MIN_INPUT_CM = 1.5;
const MIN_PATIENT_INPUT_CM = 1.0; // 患者信息框最小宽。★ 原 Word 里"姓名__性别_年龄_…住院号___日期：__年__月__日"
                                  //   是**一整行**（下划线只有 ~1cm 宽），设 2.2cm 会把整行挤成两行。
const GAP_CM = 0.03;             // 元素间隙：Word 是字符连续排列，间隙过大会把长行挤断
const CHECK_BOX_W_CM = 0.42;
const CHECK_GAP_CM = 0.12;
const ROW_MIN_H_CM = 0.48;
const LINE_H_FACTOR = 1.23;      // 行高 = 字号 × 系数。
                                 // 下限由"组件渲染高 = 组件height + 外壳1.6px×2"决定：
                                 // 组件高系数 1.00 时，行高系数必须 ≥ 1.23 才不压叠；原 Word 行距也接近此值。
const UNIT_WORDS = /^(年|月|日|时|分|秒|岁|次|度|cm|CM|mm|mmHg|ml|ML|L|kg|g|mg|％|%|℃|·|\/分)$/;

/**
 * 单串宽度（cm）
 *
 * ★ 两个实测校准（设计器 DOM 实测，不是理论值）：
 *   1) **CJK 实际宽度 ≈ 1.09em**：14px 字号下 8 个汉字渲染出 122.4px ⇒ 15.3px/字。
 *      若按 1em 算，"ASA分级："（3 ASCII + 3 CJK）算得 63px、给 70px 仍会被折成两行。
 *   2) **组件外壳内缩 ≈ 1.6px**：`directive-wrap > label-container` 比 width 少约 1.6px。
 *      按理论字宽定宽会让中文**逐字换行成竖排**。
 *   故：CJK 按 1.10em、ASCII 按 0.62em（大写字母偏宽），再 ×1.06 + 0.04cm 兜底。
 */
const CJK_RATIO = 1.10;
const ASCII_RATIO = 0.62;
const SPACE_RATIO = 0.45;      // ★ 空格单独按 0.45em：按 0.62em 会把"下划线填空"算得过宽，
                               //   导致"一、镇痛前诊断：__ ASA分级__级 VAS评分__分"整行放不下而折行
const TEXT_SAFETY_RATIO = 1.06;
const TEXT_SAFETY_CM = 0.04;
function textWidthCm(str, sizePt) {
  if (!str) return 0;
  let w = 0;
  for (const ch of String(str)) {
    if (/[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch)) w += sizePt * CJK_RATIO;
    else if (ch === '\t') w += sizePt * 2;
    else if (ch === ' ') w += sizePt * SPACE_RATIO;
    else w += sizePt * ASCII_RATIO;
  }
  return pt2cm(w) * TEXT_SAFETY_RATIO + TEXT_SAFETY_CM;
}

// ================= 1) runs → segments =================
function segmentize(para) {
  const segs = [];
  for (const run of para.runs) {
    const text = run.text;
    if (!text) continue;
    if (run.underline && /^[\s\u3000]+$/.test(text)) {
      segs.push({ kind: 'input', spaces: text.length, sizePt: run.sizePt });
      continue;
    }
    let buf = '';
    const flush = () => {
      if (!buf) return;
      const isBlank = /^[\s\u3000]+$/.test(buf);
      segs.push({
        kind: (run.underline && isBlank) ? 'input' : 'text',
        text: buf, spaces: buf.length, sizePt: run.sizePt, bold: run.bold,
      });
      buf = '';
    };
    for (const ch of text) {
      if (ch === '□' || ch === '☐') {
        flush();
        segs.push({ kind: 'check', sizePt: run.sizePt });
        continue;
      }
      buf += ch;
    }
    flush();
  }
  return segs;
}

// ================= 2) 文本拆 head / tail =================
/** "否    双下肢活动" → head="否    ", tail="双下肢活动"（按最后一个空白段切） */
function splitHeadTail(s) {
  if (!s) return { head: '', tail: '' };
  const trimmed = s.trim();
  if (!trimmed) return { head: s, tail: '' };
  // 以句号/分号结尾，或明显过长 → 是句子/单位后缀，不是标签
  if (/[。；;！？]$/.test(trimmed) || trimmed.length > 14) return { head: s, tail: '' };
  const m = s.match(/^([\s\S]*?)([\s\u3000]+)([^\s\u3000]+)$/);
  if (m && m[3]) return { head: m[1] + m[2], tail: m[3] };
  return { head: '', tail: trimmed };
}

/** 括号内说明（"（稀释用液："）不算标签 */
function looksLikeLabel(t) {
  const s = (t || '').trim();
  if (!s || s.length > 24) return false;
  if (/[（(]/.test(s) && !/[）)]/.test(s)) return false;
  return true;
}

// ================= 3) segments → tokens =================
function tokenize(segs) {
  const tokens = [];
  for (const seg of segs) {
    if (seg.kind === 'check') { tokens.push({ k: 'check', sizePt: seg.sizePt }); continue; }
    if (seg.kind === 'input') { tokens.push({ k: 'input', spaces: seg.spaces, sizePt: seg.sizePt }); continue; }

    let buf = '';
    const sizePt = seg.sizePt;
    for (const ch of seg.text) {
      if (ch === '：' || ch === ':') {
        const { head, tail } = splitHeadTail(buf);
        // 括号未闭合（如"（总量："）不是标签
        const parenOpen = /[（(]/.test(buf) && !/[）)]/.test(buf);
        if (head.trim()) tokens.push({ k: 'text', text: head, sizePt });
        if (tail && !parenOpen && looksLikeLabel(tail)) tokens.push({ k: 'label', text: tail, sizePt });
        else if (tail) tokens.push({ k: 'text', text: tail + ch, sizePt });
        buf = '';
      } else buf += ch;
    }
    // 把 head（前一段尾巴）与新标签拆开：先尝试整体入 text，标签留给后续 input/check 提升
    if (buf) tokens.push({ k: 'text', text: buf, sizePt });
  }
  return tokens;
}

// ================= 4) tokens → clauses =================
function toClauses(segs) {
  const tokens = tokenize(segs);
  const clauses = [];
  let cur = { label: '', items: [] };
  let pending = '';
  let pendingSize = null;

  const flushCur = () => {
    if (cur.label || cur.items.length) clauses.push(cur);
    cur = { label: '', items: [] };
  };

  const absorbPendingIntoCur = () => {
    if (!pending.trim()) { pending = ''; return; }
    const { head, tail } = splitHeadTail(pending);
    if (head.trim()) cur.items.push({ k: 'text', text: head, sizePt: pendingSize });
    if (tail && tail.trim()) cur.items.push({ k: 'text', text: tail, sizePt: pendingSize });
    pending = '';
  };

  for (const t of tokens) {
    if (t.k === 'label') {
      const lastIsCheck = cur.items.length > 0 && cur.items[cur.items.length - 1].k === 'check';
      // 仅当该勾选框还没有选项文字时（pending 为空），这个"标签"才是它的选项文本（例："□有："）
      // 若 pending 非空（例："□否    双下肢活动："），说明"否"已是选项，"双下肢活动"是新题组
      if (lastIsCheck && pending.trim() === '') {
        cur.items.push({ k: 'text', text: t.text, sizePt: t.sizePt });
        pending = '';
        flushCur();
        continue;
      }
      absorbPendingIntoCur();
      flushCur();
      cur.label = t.text.trim();
      continue;
    }
    if (t.k === 'text') {
      if (pending === '') pendingSize = t.sizePt;
      pending += t.text;
      continue;
    }
    if (t.k === 'input') {
      const hasCheck = cur.items.some((x) => x.k === 'check');
      if (hasCheck) {
        const lastItem = cur.items[cur.items.length - 1];
        if (lastItem && lastItem.k === 'input' && pending.trim()) {
          // 形如"□试验量 ___ ％利多卡因 ___"：勾选项已配过输入框，pending 是新字段的标签
          const { head, tail } = splitHeadTail(pending);
          if (head.trim()) cur.items.push({ k: 'text', text: head, sizePt: pendingSize });
          pending = '';
          flushCur();
          if (tail && tail.trim()) cur.label = tail.trim();
          cur.items.push({ k: 'input', spaces: t.spaces, sizePt: t.sizePt });
          continue;
        }
        // 例："过敏史：□无□有        " —— "有"是勾选项，后面的下划线是题组的补充填写区
        if (pending) { cur.items.push({ k: 'text', text: pending, sizePt: pendingSize }); pending = ''; }
        cur.items.push({ k: 'input', spaces: t.spaces, sizePt: t.sizePt });
        continue;
      }
      const { head, tail } = splitHeadTail(pending);
      const isUnit = UNIT_WORDS.test((tail || '').trim());
      if (head.trim()) cur.items.push({ k: 'text', text: head, sizePt: pendingSize });
      pending = '';
      if (tail && tail.trim() && !isUnit) {
        flushCur();
        cur.label = tail.trim();
      } else if (tail && tail.trim()) {
        cur.items.push({ k: 'text', text: tail, sizePt: pendingSize });
      }
      cur.items.push({ k: 'input', spaces: t.spaces, sizePt: t.sizePt });
      continue;
    }
    if (t.k === 'check') {
      const hadCheck = cur.items.some((x) => x.k === 'check');
      if (!hadCheck) {
        const { head, tail } = splitHeadTail(pending);
        if (head.trim()) cur.items.push({ k: 'text', text: head, sizePt: pendingSize });
        if (tail && tail.trim()) {
          if (cur.label && cur.items.length) {
            // 当前子句已是完整字段（如"胎儿娩出时间：___"），后面的文本是新题组的标签
            flushCur();
            cur.label = tail.trim();
          } else if (!cur.label) {
            cur.label = tail.trim();
          } else {
            cur.items.push({ k: 'text', text: tail, sizePt: pendingSize });
          }
        }
        pending = '';
      } else if (pending) {
        // 连续 □ 之间的文本 = 上一个勾选框的选项文字
        cur.items.push({ k: 'text', text: pending, sizePt: pendingSize });
        pending = '';
      }
      cur.items.push({ k: 'check', sizePt: t.sizePt });
      continue;
    }
  }
  absorbPendingIntoCur();
  flushCur();
  return clauses;
}

// ================= 5) clauses → atoms =================
function clausesToAtoms(clauses, registry, ctx) {
  const atoms = [];
  let groupSeq = 0;
  let lastLabel = ctx.lastLabel || '';

  for (const clause of clauses) {
    groupSeq += 1;
    const group = groupSeq;
    const rawLabel = (clause.label || '').trim();
    const cleanLabel = registry.cleanLabel(rawLabel);
    const sizePt = clause.items.length ? clause.items[0].sizePt : ctx.defaultSizePt;

    const checks = clause.items.filter((i) => i.k === 'check');
    const inputs = clause.items.filter((i) => i.k === 'input');

    // ---------- (a) 勾选题组 ----------
    if (checks.length) {
      let glabelRaw = rawLabel || (lastLabel ? `${lastLabel}项` : `选项${group}`);
      // ★ 题组不要回落到 patient.*：患者信息是只读字段，勾选组占用它会与患者信息行的只读框撞同一 value
      const groupField = registry.fieldValue(glabelRaw, { noPatient: true });
      if (rawLabel) {
        atoms.push({ kind: 'label', text: rawLabel + '：', w: textWidthCm(rawLabel + '：', sizePt), sizePt, group: 0, tone: 'strong' });
        lastLabel = cleanLabel;
      }

      // ★ 严格按 items 顺序输出：
      //   - check **之前**的文本是正文内容（例："□试验量 __ ％利多卡因 __ ml。□追加量…" 里的 "ml。"），不能吞掉
      //   - 选项文本只取 check 之后**紧邻**的那段（遇到 input 即结束）
      //   - 题组里的输入框按原位置输出
      // ★ 单选组：multiSelect 必须与设计器真实导出**完全一致**（成品表单里是 null，不是 false）。
      //   实测：multiSelect:false 会让同组点选**不互斥**（"是""否"能同时勾上）。
      const multi = null;
      let curOpt = null;
      const flushOpt = () => {
        if (!curOpt) return;
        const optText = (curOpt.text || '').replace(/\s+/g, ' ').trim();
        curOpt = null;
        if (!optText) return;
        const code = registry.optionCode(groupField.value, optText);
        const w = CHECK_BOX_W_CM + CHECK_GAP_CM + textWidthCm(optText, sizePt);
        atoms.push({
          kind: 'check', text: optText, w: w + 0.22, sizePt, group,
          // ★ 同组共享 value（设计器据此识别"互斥单选组"），各选项用 code 区分。
          //   代价：保存时设计器会标红并弹「数据名称出现重复」确认框 —— 点【确定】即可保存
          //   （源码 saveForm(): n.every(e=>"checkBox"===e.type) → modal.confirm({ nzOnOk: () => t() })）。
          fieldValue: groupField.value, optionCode: code,
          isPatient: groupField.isPatient, multiSelect: multi,
        });
      };

      for (const item of clause.items) {
        if (item.k === 'check') {
          flushOpt();
          curOpt = { text: '' };
        } else if (item.k === 'text') {
          if (curOpt) curOpt.text += item.text;
          else {
            const t = String(item.text || '').replace(/\s+/g, ' ').replace(/\s+$/, '');
            if (t.trim()) atoms.push({ kind: 'label', text: t, w: textWidthCm(t, sizePt), sizePt, group: 0, tone: 'normal' });
          }
        } else if (item.k === 'input') {
          flushOpt();
          const w = Math.max(textWidthCm(' '.repeat(item.spaces), item.sizePt), MIN_INPUT_CM);
          const base = cleanLabel || lastLabel || 'note';
          const v = registry.fieldValue(`${base}说明`, { noPatient: true, silent: true });
          atoms.push({
            kind: 'input', w, sizePt, group: 0, flexible: true,
            fieldLabel: base, inputType: 'textField',
            fieldValue: v.value, isPatient: false, preAssigned: true,
          });
        }
      }
      flushOpt();
      continue;
    }

    // ---------- (b) 纯文本 ----------
    if (!inputs.length) {
      const text = clause.items.map((i) => i.text || '').join('').replace(/\s+/g, ' ').trim();
      if (rawLabel) lastLabel = cleanLabel;
      if (rawLabel || text) {
        const full = rawLabel ? `${rawLabel}：${text}` : text;
        if (full.trim()) {
          atoms.push({ kind: 'label', text: full.replace(/\s+$/, ''), w: textWidthCm(full, sizePt), sizePt, group: 0, tone: rawLabel ? 'strong' : 'normal' });
        }
      }
      continue;
    }

    // ---------- (c) 标签 + 输入框 ----------
    if (rawLabel) {
      atoms.push({ kind: 'label', text: rawLabel + '：', w: textWidthCm(rawLabel + '：', sizePt), sizePt, group, tone: 'strong' });
      lastLabel = cleanLabel;
    }

    const wholeText = clause.items.map((i) => i.text || '').join(' ');
    const isDate = /时间|日期|时刻/.test(cleanLabel) || /[年月日].*[年月日]/.test(wholeText);
    const isSign = /签名|签字/.test(cleanLabel);
    // 枚举字段（性别 / ASA分级 / 血型…见 field-map.js 的 SELECT_FIELDS）→ 用下拉框
    const selectOptions = (!isSign && !isDate) ? registry.matchSelect(rawLabel) : null;
    let inputType = 'textField';
    if (isSign) inputType = 'ca-signature';
    else if (isDate) inputType = 'modalDatePicker';
    else if (selectOptions) inputType = 'select';

    const fieldValue = rawLabel
      ? registry.fieldValue(rawLabel)
      : registry.fieldValue(lastLabel ? `${lastLabel}内容` : `字段${group}`);

    // 年/月/日 结构：忠实还原为多个小输入框
    const hasYMD = /[年月日]/.test(wholeText) && (wholeText.match(/[年月日]/g) || []).length >= 2;
    if (hasYMD && !isSign) {
      const suffixes = { '年': 'Year', '月': 'Month', '日': 'Day' };
      let idx = 0;
      for (const item of clause.items) {
        if (item.k === 'input') {
          const ym = ['年', '月', '日'][Math.min(idx, 2)];
          const v = registry.fieldValue(`${cleanLabel || 'date'}${suffixes[ym]}`, { silent: true });
          atoms.push({
            kind: 'input', w: Math.max(textWidthCm(' '.repeat(item.spaces), item.sizePt), 1.05),
            sizePt, group: 0, fieldLabel: cleanLabel,
            inputType: 'textField', fieldValue: v.value, isPatient: false, preAssigned: true,
          });
          idx += 1;
        } else if (item.k === 'text' && item.text.trim()) {
          const t = item.text.trim();
          atoms.push({ kind: 'label', text: t, w: textWidthCm(t, sizePt), sizePt, group: 0, tone: 'normal' });
        }
      }
      continue;
    }

    let placed = false;
    for (const item of clause.items) {
      if (item.k !== 'input') {
        if (item.k === 'text' && item.text.trim()) {
          const t = item.text.replace(/\s+/g, ' ').replace(/\s+$/, '');
          if (t.trim()) {
            // 单位词（分/级/cm/mmHg…）与前一个字段同组，避免"VAS评分：__ 分"被折行拆开
            const unit = UNIT_WORDS.test(t.trim());
            atoms.push({ kind: 'label', text: t, w: textWidthCm(t, sizePt), sizePt, group: unit ? group : 0, tone: 'normal' });
          }
        }
        continue;
      }
      if (placed) {
        // 同一标签下的多余输入框（如"科室：__ __"）：独立字段，且不得回落到 patient.*
        atoms.push({
          kind: 'input', w: Math.max(textWidthCm(' '.repeat(item.spaces), item.sizePt), MIN_INPUT_CM),
          sizePt, group: 0, fieldLabel: '', inputType: 'textField',
          fieldValue: registry.fieldValue(`${cleanLabel || lastLabel}附加项`, { noPatient: true, silent: true }).value,
          isPatient: false, preAssigned: true,
        });
        continue;
      }
      let w = Math.max(textWidthCm(' '.repeat(item.spaces), item.sizePt), fieldValue.isPatient ? MIN_PATIENT_INPUT_CM : MIN_INPUT_CM);
      if (rawLabel && rawLabel.length > 8) w = Math.max(w, 2.6);
      if (inputType === 'ca-signature') w = Math.max(w, 2.4);
      if (inputType === 'select') w = Math.max(w, 4.2);   // 下拉框要够宽，否则选项文字被截
      // 无标签的大空白：按原版式做成"下划线填空区"，可随行宽收缩
      const flexible = !rawLabel;
      atoms.push({
        kind: 'input', w, sizePt, group: rawLabel ? group : 0,
        fieldLabel: cleanLabel, inputType, fieldValue: fieldValue.value,
        isPatient: fieldValue.isPatient, flexible,
        options: selectOptions || undefined,
      });
      placed = true;
    }
  }

  return { atoms, lastLabel };
}

// ================= 6) 排布 =================
function layoutRows(atoms, usableW, opts = {}) {
  const rows = [];
  let row = [];
  let x = 0;
  let rowH = 0;
  const startX = opts.startX || 0;
  let curX = startX;

  const rowWidth = () => row.reduce((s, a) => s + a.w + GAP_CM, 0);
  const flush = () => {
    if (row.length) rows.push({ atoms: row, h: Math.max(rowH, ROW_MIN_H_CM) });
    row = []; curX = startX; rowH = 0;
  };

  for (const a of atoms) {
    const avail = usableW - (curX - startX);
    // 弹性元素：自动收缩到剩余宽度（还原"下划线填满整行"的原版式）
    if (a.flexible && avail > MIN_INPUT_CM + 0.2 && a.w > avail - GAP_CM) {
      a.w = Math.round((avail - GAP_CM) * 100) / 100;
    }
    const w = a.w + GAP_CM;
    let overflow = (curX + w - startX) - usableW;

    // ★ 折行前先"压缩本行"：把本行已放入的输入框按比例收窄，给紧凑的长行腾出空间。
    //   原实现一放不下就直接折行，导致"本来 Word 里是一行"的紧凑段被拆成两三行。
    if (overflow > 0.001 && row.length) {
      const flex = row.filter((r) => r.kind === 'input');
      const flexSum = flex.reduce((s, r) => s + r.w, 0);
      const minEach = 1.0;                                   // 输入框最窄 1.0cm，仍能点进去填写
      const canShrink = Math.max(0, flexSum - flex.length * minEach);
      const shrink = Math.min(overflow, canShrink);
      if (shrink > 0.03) {
        const k = (flexSum - shrink) / flexSum;
        for (const f of flex) f.w = Math.max(minEach, Math.round(f.w * k * 100) / 100);
        curX -= shrink;
        overflow = (curX + w - startX) - usableW;
      }
    }

    if (overflow > 0.001 && row.length) {
      // 同组元素（标签+它的输入框）不断开：整组下移
      if (a.group && row.some((r) => r.group === a.group)) {
        const members = row.filter((r) => r.group === a.group);
        const rest = row.filter((r) => r.group !== a.group);
        row = rest; rowH = rest.length ? rowH : 0;
        flush();
        row = members;
        curX = startX + rowWidth();
      } else {
        flush();
      }
    }
    row.push(a);
    curX += a.w + GAP_CM;
    const h = a.sizePt ? pt2cm(a.sizePt) * LINE_H_FACTOR : 0.45;
    rowH = Math.max(rowH, h);
  }
  flush();

  let y = 0;
  for (const r of rows) { r.y = y; r.x0 = startX; y += r.h; }
  return rows;
}

/** 患者信息行：按可用宽度**等比缩放**（既放大也收缩），保证"姓名__性别_…日期：__年__月__日"落在同一行 */
function stretchPatientRow(atoms, usableW) {
  const inputs = atoms.filter((a) => a.kind === 'input');
  if (inputs.length < 2) return atoms;
  const fixed = atoms.reduce((s, a) => s + (a.kind === 'input' ? 0 : a.w) + GAP_CM, 0);
  const avail = usableW - fixed;
  if (avail <= 1) return atoms;
  const curSum = inputs.reduce((s, a) => s + a.w, 0);
  if (curSum <= 0) return atoms;
  // ★ 必须同时支持收缩：内容本身就比可用宽长时（原 Word 的下划线只有 ~1cm），
  //   只放大不收缩会让整行折成两行。
  // 留 2% 余量：组件宽度四舍五入后可能刚好顶到可用宽，导致最后一个字被折走
  const scale = Math.min(Math.max((avail * 0.98) / curSum, 0.3), 3.0);
  for (const a of inputs) a.w = Math.max(0.5, Math.round(a.w * scale * 100) / 100);
  return atoms;
}

module.exports = {
  segmentize, toClauses, clausesToAtoms, layoutRows, stretchPatientRow,
  textWidthCm, splitHeadTail, tokenize,
  CONST: { MIN_INPUT_CM, MIN_PATIENT_INPUT_CM, GAP_CM, CHECK_BOX_W_CM, CHECK_GAP_CM, ROW_MIN_H_CM, LINE_H_FACTOR },
};
