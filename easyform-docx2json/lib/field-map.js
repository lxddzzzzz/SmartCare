'use strict';
/**
 * field-map.js — 中文标签 → 设计器数据字段名（value）
 *
 * 三层策略（确定性，不产生神秘随机码）：
 *   1. 患者信息：精确命中权威表 → patient.*
 *      ★ 依据《分析_表单引擎.md》§1.4 表格①（前端"病人信息"面板 31 项）
 *      ★ 修正既有工具链的两处错误：性别 = patient.gender（不是 sex）、住院号 = patient.mrn（不是 hisPid）
 *   2. 业务字段：少量语义词典（关键高频词）→ 语义名；否则中文转拼音（pinyin-pro，确定性）
 *   3. 唯一性：字段名全局去重（重复自动加 _2/_3），避免设计器"数据名称重复"校验拦截
 *
 * 选项 code 规则（与真实成品表单一致，见 testexam/患者入院护理评估表.json）：
 *   同一个题组的多个 checkBox 共享同一个 value，各自 code = 选项拼音；不同题组出现同名
 *   选项（如"正常"）时 code 允许重复 —— 成品表单里就是这么存的。
 */

const { pinyin } = require('pinyin-pro');

// ============ 1. 患者信息权威字段表（patient.*）============
// 中文（面板显示名）→ 字段名；别名一并列出
const PATIENT_FIELDS = {
  '姓名': 'patient.name',
  '病人姓名': 'patient.name',
  '患者姓名': 'patient.name',
  '性别': 'patient.gender',
  '年龄': 'patient.age',
  '儿童年龄': 'patient.childAge',
  '床号': 'patient.showBed',
  'his床号': 'patient.hisBed',
  '科室': 'patient.dept',
  '病人科室': 'patient.dept',
  '病区': 'patient.dept',
  '病区编码': 'patient.wardCode',
  '病区名称': 'patient.wardName',
  '住院号': 'patient.mrn',
  '病案号': 'patient.caseNo',
  '既往史': 'patient.pastHistory',
  '管床医师': 'patient.bedPhysician',
  '主管医师': 'patient.bedPhysician',
  '床位医师': 'patient.bedPhysician',
  '责任护士': 'patient.responsibleNurse',
  '入院时间': 'patient.admissionTime',
  '入科时间': 'patient.icuAdmissionTime',
  '出科时间': 'patient.icuDischargeTime',
  '过敏史': 'patient.allergic',
  '身高': 'patient.height',
  '体重': 'patient.weight',
  '民族': 'patient.nation',
  '职业': 'patient.occupation',
  '护理等级': 'patient.nursingLevel',
  '护理级别': 'patient.nursingLevel',
  '转床号': 'patient.patBedHistories',
  '病情分级': 'patient.illnessLevel',
  '入科来源': 'patient.admissionSource',
  '临床诊断': 'patient.clinicalDiagnosis',
  '入院诊断': 'patient.admissionDiagnosis',
  '出科诊断': 'patient.dischargedDiagnosis',
  '手术时间': 'patient.patientOperations',
  '手术名称': 'patient.patientOperations',
  '联系电话': 'patient.tel',
  '联系人': 'patient.contactsName',
  '联系地址': 'patient.contactAddress',
};

// 患者字段里"故意不映射"的（单位词等）
const PATIENT_SKIP = new Set(['岁', '月', '日', '年', '时', '分', 'cm', 'mmHg', 'ml', 'kg']);

// ============ 2. 业务字段语义词典 ============
// 只收录"拼音不好看/有歧义/高频"的；其余一律走拼音自动生成
const FORM_HINTS = {
  // 麻醉/镇痛
  '镇痛前诊断': 'diagnosisBeforeAnalgesia',
  'ASA分级': 'asaGrade',
  'VAS评分': 'vasScore',
  '生命体征平稳': 'vitalSignsStable',
  '双下肢活动': 'lowerLimbActivity',
  '脊柱异常': 'spineAbnormal',
  '特殊用药史': 'specialMedicationHistory',
  '血常规': 'bloodRoutine',
  '凝血常规': 'coagulationRoutine',
  '电解质': 'electrolyte',
  '肝功能': 'liverFunction',
  '肾功能': 'kidneyFunction',
  'ECG': 'ecg',
  '麻醉方法': 'anesthesiaMethod',
  '穿刺间隙': 'punctureSpace',
  '硬膜外置管深度': 'epiduralCatheterDepth',
  '置管方向': 'catheterDirection',
  '镇痛方法和用药': 'analgesiaMethodAndDrug',
  '配药方案': 'drugPreparation',
  '试验量': 'testDose',
  '追加量混合液': 'additionalDose',
  '监测记录': 'monitoringRecord',
  '宫口': 'cervixDilation',
  '注药时间': 'injectionTime',
  '胎儿娩出时间': 'fetalDeliveryTime',
  '是否改剖宫产术': 'convertedToCesarean',
  '与产房助产士交班时间': 'handoverTime',
  '分娩后评估': 'postpartumAssessment',
  '完整拔出硬膜外导管时间': 'catheterRemovalTime',
  '麻醉并发症': 'anesthesiaComplication',
  '麻醉医师签名': 'anesthesiologistSignature',
  '巡回护士签名': 'circulatingNurseSignature',
  '助产士签名': 'midwifeSignature',
  '日期': 'date',
  '时间': 'time',
  '备注': 'remark',
  // 常用选项
  '未见': 'notSeen',
  '大致正常': 'roughlyNormal',
  '异常': 'abnormal',
  '正常': 'normal',
  '无': 'none',
  '有': 'yes',
  '是': 'yes',
  '否': 'no',
  '其他': 'other',
  '硬脊膜穿破硬膜外阻滞': 'combinedSpinalEpidural',
  '硬膜外阻滞': 'epiduralBlock',
  '连续硬膜外镇痛': 'continuousEpiduralAnalgesia',
  '穿刺点疼痛': 'punctureSitePain',
  '穿刺点感染': 'punctureSiteInfection',
  '头痛': 'headache',
  '罗派卡因': 'ropivacaine',
  '舒芬太尼': 'sufentanil',
  '利多卡因': 'lidocaine',
};

// ============ 3. 枚举字段 → 下拉框（select）============
// ⚠️ 已按反馈**全部还原**：原 Word 文书里没有任何表单域（w:sdt / w:dropDownList / w:ffData 均为 0），
//    无法从文档推断哪些字段该做下拉，因此默认一个都不启用（全部按原版式生成文本/勾选）。
//    需要某字段做下拉时，取消下面注释并加一行即可（结构对齐设计器真实导出：options=[{label,value}]）。
const SELECT_FIELDS = {
  // '性别': ['男', '女'],
  // 'ASA分级': ['I级', 'II级', 'III级', 'IV级', 'V级', 'VI级'],
  // '血型': ['A型', 'B型', 'O型', 'AB型', '不详'],
  // '分娩方式': ['自然分娩', '剖宫产术', '产钳助产', '胎头吸引'],
};

/** 中文标签 → 下拉选项（返回 [{label,value}] 或 null） */
function matchSelect(rawLabel) {
  const c = cleanLabel(rawLabel);
  if (!c) return null;
  let hit = SELECT_FIELDS[c];
  if (!hit) {
    for (const k of Object.keys(SELECT_FIELDS)) {
      if (c.includes(k) && c.length / k.length <= 1.5) { hit = SELECT_FIELDS[k]; break; }
    }
  }
  if (!hit) return null;
  return hit.map((l) => ({ label: l, value: toFieldName(l, 16) }));
}

/** 去掉编号前缀、冒号、空白，便于比对 */function cleanLabel(s) {
  if (!s) return '';
  let t = String(s).trim();
  t = t.replace(/^[一二三四五六七八九十]+[、.．,，]\s*/, '');
  t = t.replace(/^[（(]\s*\d+\s*[）)]\s*/, '');
  t = t.replace(/^\d+\s*[、.．)]\s*/, '');
  t = t.replace(/[：:]\s*$/, '');
  t = t.replace(/[\s\u3000]+/g, '');
  return t;
}

/** 中文 → 拼音字段名（小写、只留字母数字、数字开头加 f 前缀、限长） */
function toFieldName(label, maxLen = 26) {
  let parts;
  try {
    parts = pinyin(label, { toneType: 'none', type: 'array', nonZh: 'consecutive' });
  } catch (e) {
    parts = [];
  }
  let s = parts.map((x) => String(x).replace(/[^a-zA-Z0-9]/g, '')).join('').toLowerCase();
  if (!s) s = 'field';
  if (/^[0-9]/.test(s)) s = 'f' + s;
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function createRegistry() {
  const usedField = new Set();      // 已分配的字段名（不含 patient.*）
  const usedOption = new Map();     // 组 value → Set(code)
  const unknown = [];               // 未命中词典的标签（供人工补充）
  const stats = { patient: 0, hint: 0, pinyin: 0, dedup: 0 };

  /** 患者字段匹配（不参与去重，同一患者字段可多处出现） */
  function matchPatient(rawLabel) {
    const c = cleanLabel(rawLabel);
    if (!c) return null;
    if (PATIENT_FIELDS[c] !== undefined) return PATIENT_FIELDS[c];
    if (PATIENT_SKIP.has(c)) return null;
    // 子串匹配：仅当包含关系且长度比 ≥ 0.6，避免"病人科室"误配到"人科"
    for (const k of Object.keys(PATIENT_FIELDS)) {
      const n = c.length <= k.length ? c.length / k.length : k.length / c.length;
      if ((c.includes(k) || k.includes(c)) && n >= 0.6) return PATIENT_FIELDS[k];
    }
    return null;
  }

  /** 分配唯一字段名（返回不含 form. 前缀的裸名） */
  function uniqueName(base) {
    let name = base;
    let i = 1;
    while (usedField.has(name)) { i += 1; name = `${base}_${i}`; stats.dedup += 1; }
    usedField.add(name);
    return name;
  }

  /**
   * 给一个中文标签分配字段名（value）
   * @returns {{value:string, isPatient:boolean, source:string}}
   */
  function fieldValue(rawLabel, opts = {}) {
    const label = cleanLabel(rawLabel) || String(rawLabel || '').trim();

    // noPatient：衍生字段（如"过敏史说明"）不得回落到 patient.*，
    // 否则"过敏史说明"会因包含"过敏史"而被误绑到 patient.allergic（与勾选框撞字段）
    if (!opts.noPatient) {
      const pc = matchPatient(label);
      if (pc) { stats.patient += 1; return { value: pc, isPatient: true, source: 'patient' }; }
    }

    if (FORM_HINTS[label] !== undefined) {
      stats.hint += 1;
      const bare = uniqueName(FORM_HINTS[label]);
      return { value: 'form.' + bare, isPatient: false, source: 'hint' };
    }

    if (label && !opts.silent) unknown.push(label);
    stats.pinyin += 1;
    const bare = uniqueName(toFieldName(label || 'field'));
    return { value: 'form.' + bare, isPatient: false, source: 'pinyin' };
  }

  /** 选项 code（组内唯一） */
  function optionCode(groupValue, optionText) {
    let set = usedOption.get(groupValue);
    if (!set) { set = new Set(); usedOption.set(groupValue, set); }
    const cleaned = cleanLabel(optionText) || optionText || 'opt';
    const base = FORM_HINTS[cleaned] !== undefined ? FORM_HINTS[cleaned] : toFieldName(cleaned, 20);
    let code = base || 'opt';
    let i = 1;
    while (set.has(code)) { i += 1; code = `${base}_${i}`; }
    set.add(code);
    return code;
  }

  /** 重置（用于"两遍生成"：第一遍测量、第二遍产出，字段名必须一致） */
  function reset() {
    usedField.clear();
    usedOption.clear();
    unknown.length = 0;
    stats.patient = 0; stats.hint = 0; stats.pinyin = 0; stats.dedup = 0;
  }

  return { fieldValue, optionCode, matchPatient, matchSelect, cleanLabel, toFieldName, unknown, stats, reset };
}

module.exports = {
  PATIENT_FIELDS, PATIENT_SKIP, FORM_HINTS, SELECT_FIELDS,
  cleanLabel, toFieldName, matchSelect, createRegistry,
};
