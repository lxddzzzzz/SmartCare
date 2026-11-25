# Word 文书 → easyform 可导入 JSON（一键画表单）

把客户给的 Word 文书（`.docx`）**直接转成 eaxy-form 设计器「导入 json 文件」能吃的 JSON**，
省掉在设计器里手工拖上百个组件。

适用设计器：**ICU SmartCare · `eaxy-form.html`**（`http://<主机>:60000/eaxy-form.html`）
产物不含 `.xy` 编码、不连数据库、不需要给客户端打补丁。

---

## 一、怎么用（3 步）

```
1. 把 .docx 放进本目录（文件名建议：表单名__表单代码__医院名.docx）
2. 执行：  node easyform-docx2json.js "你的文书.docx" --out 生成结果
3. 打开设计器 → 顶部「导入 json 文件」→ 选 生成结果\你的文书.json → 点「保存表单」
```

不想敲命令：**把 .docx 文件直接拖到 `转换.bat` 上**即可（产物落在 `output\`）。

命令行参数：

| 参数 | 说明 |
|---|---|
| `--formName 名称` | 指定表单显示名（默认取文件名第一段） |
| `--formCode 代码` | 指定表单代码（默认取文件名第二段，没有就用表单名拼音） |
| `--hospitalName 医院` | 医院名（仅记录，默认取文件名第三段） |
| `--out 目录` | 输出目录（默认与 docx 同目录） |

支持一次传多个 `.docx`。

---

## 二、产出物

| 文件 | 说明 |
|---|---|
| `<表单代码>.json` | ★ 设计器导入用的成品 |
| `<表单代码>.unknown.txt` | 未命中词典的中文标签（想得到更可读的字段名就补到 `lib/field-map.js` 的 `FORM_HINTS`） |
| `*.preview.html` | 可视化预览（`node preview_html.js x.json` 生成），不打开设计器也能核对版式 |

自检工具：

```bash
node check_json.js   x.json   # 残留勾选框 / 题组 / 字段重复 / 重叠 / 越界 / 填充率
node validate_json.js x.json  # 与设计器真实导出文件逐字段比对，确认键集合一致
node dump_layout.js  x.json --cm   # 把 JSON 还原成"按行文本预览"
node diag.js         x.json   # 诊断相邻行间距
```

---

## 三、转换规则（做了什么）

### 3.1 文字 → 组件

| Word 里的形态 | 转成 | 说明 |
|---|---|---|
| 普通文字 | `label` | 标题自动居中加粗（段落本身居中、且只有一行短文本时） |
| 下划线空白 `____` | `textField`（`isNoBorder:true` 下划线式） | 宽度按原文字符数还原，过窄的会补到最小可填宽度 |
| `□` + 选项文字 | `checkBox` | **同一题组的多个选项共享 `value`，各自 `code`=选项拼音** |
| 含"签名/签字"的空白 | `ca-signature` | |
| 含"时间/日期"的空白 | `modalDatePicker` | `format:yyyy-MM-dd HH:mm`，默认取系统时间 |
| `____年__月__日` | 3 个 `textField` | 忠实还原原版式（不合并成一个日期控件） |
| 表格 | 每行一个 `table` 组件 + 单元格内文字/输入框 | 超宽自动等比缩放到内容宽 |

### 3.2 字段命名（`value`）

三层，确定性、可读、不产生随机码：

1. **患者信息**：精确匹配权威表 → `patient.*`
   （姓名 `patient.name`、性别 `patient.gender`、年龄 `patient.age`、科室 `patient.dept`、
   床号 `patient.showBed`、住院号 `patient.mrn`、过敏史 `patient.allergic` …）
2. **业务字段**：`lib/field-map.js` 的 `FORM_HINTS` 语义词典 → `form.血常规=form.bloodRoutine`
3. **兜底**：中文转拼音（`pinyin-pro`）→ `form.shengmingtizhengpingwen`

**全局唯一性**：重名自动加 `_2`/`_3`，避免设计器"数据名称重复"校验拦截。

### 3.3 几何

- 单位：内部用 cm 计算，输出时 `rem = cm × 2.3622`（设计器几何单位；**1rem = 12pt**，A4 = 49.6rem × 70.16rem）
- 页边距：顶层 `padding*` 用 **mm**（设计器约定），取 5mm
- 行高 = 字号 × 1.42；组件高 = 字号 × 1.32（略小于行高，保证相邻行不压叠）
- 一行放不下自动折行；**"标签 + 它的输入框"视为不可分组，不会被拆到两行**
- 患者信息行（姓名/性别/年龄/科室/床号/住院号…）按可用宽度**弹性铺满**

#### ★ 宽度必须留余量（真设计器实测教训，别删）

用 Playwright 连 CDP 打开真设计器量 DOM 得到的事实：

| 项 | 实测 |
|---|---|
| `.page-size` | 794 × 1123 px（A4 @96dpi） |
| `.page-container` | 756 × 1085 px，左上角偏移 19px（=5mm，说明 `padding` 按**毫米**生效） |
| 组件外壳 | `directive-wrap > df-label > label-container`，**内容区比 `width` 少约 1.6px** |
| `fontSize: 0.875` | 渲染 `font-size: 14px`（**rem ×16**）✓ |
| `width: 1.11` | 渲染 `41.9px`（1.11cm=41.96px）✓ |

**坑 1（文字竖排 / 标签折行）**：**CJK 实际宽度 ≈ 1.09em**（实测 14px 字号下 8 个汉字渲染 122.4px ⇒ 15.3px/字），
不是 1em。若按 1em 算，"ASA分级："（3 ASCII + 3 CJK）算得 63px、给 70px，**仍会被折成两行**
（实测 `69.6×28px` 两行 → 校准后 `78.1×14px` 单行）。
**对策**：CJK 按 **1.10em**、ASCII 按 **0.62em**（大写字母偏宽），再 ×1.06 + 0.04cm 兜底；
外加组件外壳内缩 1.6px。表格单元格内文字放不下时自动等比缩字号。

**坑 2（下划线看不见）**：设计器 `df-text-field.getStyle()` 是
`borderBottomColor = isNoBorder===true ? 'transparent' : color` ——
即 **`isNoBorder:true` 会把下划线变透明**（文档里"无边框（下划线式）"的表述容易理解反）。
**要带出下划线必须 `isNoBorder:false`。**

**坑 3（画布溢出 → 截图错位）**：内容宽占满内容区时，组件外壳外扩 1.6px 会让
`.page-container` 的 `scrollWidth > clientWidth`，画布一滚动，元素截图就偏。
**对策**：排版宽度 = 内容区宽 − 0.3cm。

#### 图片必须留位

Word 里的浮动图（`wp:anchor`，`wrapSquare`/`wrapNone`）**不占文档流**，但版式上是有位置的。
本工具会读取 `wp:extent`（EMU → cm）并在该段之后留出等高空白：
宽度 ≥8cm 或面积 ≥20cm² 的图留位（如"疼痛评分量表" 18.74×5.84cm），
小图（1.93×1.86cm 的照片/logo）不占位以免把标题挤散。

#### 超页自动分页

留位后内容常超过一页。生成器会**按"文档块"分页**（一个 docx 段落 = 一块，一张 docx 表格 = 一块），
**整张表格永远不会被劈到两页**；输出 `pages: [{components}, ...]`（设计器的多页结构）。

#### ★ 勾选框（单(多)选框）的两个关键事实（实测）

**事实 1：编辑态不跑业务逻辑，预览态才互斥。**
在设计器**编辑态**点同组两个勾选框，两个都会亮（看起来能多选）；这不是产物的问题——
设计器编辑态的点击只切换视觉状态，单选互斥由 `checkBoxValChange` 在**填单/预览**时执行。
实测（`click_test_preview.js`，在「表单预览」里点）：

```
点第1个("是"): 是=true,  否=false
点第2个("否"): 是=false, 否=true      ← 互斥正常
```

**事实 2：`multiSelect` 要落成 `null`，不能落成 `false`。**
设计器真实导出（`患者入院护理评估表.json`）里单选组的 `multiSelect` 是 **`null`**。
早期实现写成 `false` 与成品不一致，已改为 `null`（`form-builder.js` 里 `a.multiSelect || null`）。

单选组的正确结构（与成品一致）：

```json
{ "type":"checkBox", "text":"是", "code":"yes", "value":"form.vitalSignsStable",
  "multiSelect":null, "isSave":true }
{ "type":"checkBox", "text":"否", "code":"no",  "value":"form.vitalSignsStable",
  "multiSelect":null, "isSave":true }
```

> 保存时设计器会把这些**同 value 的 checkBox 组**标红并弹「数据名称出现重复」确认框
> （源码 `saveForm()`：`if (n.every(e => "checkBox" === e.type)) modal.confirm({ nzOnOk: () => t() })`），
> 问的是"这些控件是否属于同一个分组（控件是否关联交互）"——**点「确定」即继续保存**。
> 只有重复项里**混有非 checkBox**时才会真的报错拦住。

#### ★ 每次改动后必跑：与原 Word 对比

```bash
node compare_with_docx.js <原文档.docx> <产物.json>
```

逐行核对：内容有没有**丢失**、有没有被**折行**拆散。
（注意：Word 段落本身也会折行——导出历史文档时会看到"姓名/性别/年龄…"在一个段落里但在版面上占两行，
所以判据以"内容是否完整"为准，行结构再看真设计器截图。）

配套：把原 Word 转成图做肉眼比对

```powershell
# Word COM 导出 HTML → Edge headless 截图
$word = New-Object -ComObject Word.Application; $word.Visible=$false
$doc = $word.Documents.Open($docx,$false,$true); $doc.SaveAs2($html, 10); $doc.Close($false); $word.Quit()
& $edge --headless=new --window-size=900,1300 --screenshot=原word图.png "file:///$html"
```

> 版式问题一律以**真设计器导入后截图**为准。注意设计器画布**按视口缩放**
> （`pxScale = clientWidth/1920*16`），所以 `elementHandle.screenshot()`/`clip` 会错位——
> 正确姿势是截整页再用 `crop_paper.ps1` 按画布底色自动定位裁剪（裁出比例应 ≈0.707）。

---

## 四、与既有工具链的差异（为什么重写）

| 问题（既有实现实测） | 本工具 |
|---|---|
| 45 个 `□` **只转出 3 个**，其余 42 个直接丢失 | **45/45 全部转出** |
| 配对成功的勾选框还留下一个重复 `label`，与原框 **100% 重叠** | 语义切分后一次性产出，**重叠 0 对** |
| 题组 `value` 退化成 `chk.check.<文本>`，跨题组同名冲突 | 题组名取自"标签："（过敏史 / 特殊用药史 / 脊柱异常…）+ 全局唯一化 |
| 性别绑 `patient.sex`、住院号绑 `patient.hisPid`（系统实际是 `gender` / `mrn`，取不到值） | 绑 **`patient.gender` / `patient.mrn`**（按《分析_表单引擎.md》§1.4 权威表校准） |
| 表格单元格里的 `□` 退化成一行纯文本（0 个勾选框） | 单元格走**同一条语义管线**（表格式文书实测 20 个勾选框） |
| 段落/表格按对象键遍历，**"段-表-段"交错会整体错位** | 按 `document.xml` 真实先后**保序** |
| 段落内 `row.y` 与全局游标双重累加 → 行距塌缩、大面积压叠 | 用段落基准 y，**重叠 0 对** |

实测对比（同一份《分娩镇痛麻醉评估与记录》）：

| 指标 | 既有工具链 | 本工具 |
|---|---|---|
| 组件数 | 94 | **201** |
| 勾选框 | 3 | **45** |
| 题组 | 3（全撞名） | **19 组** |
| 患者字段 | 1（且 sex/hisPid 取不到值） | **8（gender/mrn 正确）** |
| 真重复字段 | — | **0** |
| 重叠 | 3 处 | **0** |
| A4 填充率 | 91% | **97%** |

---

## 五、已知限制 / 可调项

1. **只支持 `.docx`**（`.doc` 请先另存为 `.docx`）；图片、页眉页脚、文本框内容不处理。
2. **复杂表格**：只处理单层表格；`vMerge` 纵向合并识别为 `restart`，跨页拆表未做。
3. **多页**：内容超过一页时**不自动分页**（当前按单页排；超出部分在设计器里手动拉页或调整行距）。
4. **题组单/多选**：默认单选（`multiSelect:false`）；选项 ≥4 且标签含"并发症/措施/原因/症状/项目/问题"等集合型语义时自动置为多选。实测不符可在设计器勾一下。
5. **选项与标签的切分**靠中文排版启发式（"最后一个空白段"切标签、冒号切标签、`□` 配相邻文本）。个别粘连（如"□右侧卧位穿刺间隙："）会把"右侧卧位"和"穿刺间隙"算作一个选项，导入后手工拆一下即可。
6. `modalDatePicker` / `ca-signature` 比设计器导出样例多一个 `isFocus:false`（该两类型在参考样例里各只有 1 个实例，属参考样本不足，无实际影响）。

调参位置：`lib/layout.js` 顶部常量（行高系数、最小输入宽、间隙、勾选框占位宽）。

---

## 六、目录结构

```
easyform生成器\
├─ easyform-docx2json.js   ★ 入口：docx → 设计器 JSON
├─ 转换.bat                 拖拽 .docx 到它上面即可转换
├─ preview_html.js          生成 HTML 版式预览
├─ check_json.js            质检（勾选框/题组/重复/重叠/越界/填充率）
├─ validate_json.js         与设计器真实导出文件逐字段比对
├─ dump_layout.js           把 JSON 还原成按行文本预览
├─ diag.js                  行间距诊断
├─ probe_docx.js            探测 docx 结构（段落/表格/□/下划线统计）
├─ probe_runs.js            段落 run 级 dump（字号/下划线/对齐/缩进）
├─ probe_styles.js          读取默认字号与页面设置
├─ debug_para.js            单段落调试（segs/clauses/atoms/rows）
├─ lib\
│   ├─ docx-reader.js       .docx → 保序中间模型
│   ├─ field-map.js         中文标签 → 字段名（患者权威表 + 词典 + 拼音）
│   ├─ layout.js            ★ 语义核心：token→clause→atom→折行排布
│   └─ form-builder.js      组件规范化 + 表格还原 + 顶层装配
├─ 生成结果\                 产物（json / unknown.txt / 预览 html / png）
└─ node_modules\            adm-zip、fast-xml-parser、pinyin-pro
```

---

## 七、加新字段词典（让字段名更可读）

编辑 `lib/field-map.js`：

```js
const FORM_HINTS = {
  // 已有…
  '护理评估': 'nursingAssessment',   // ← 新增：命中后字段名变成 form.nursingAssessment
  '体温': 'temperature',
};
```

患者字段若要新增/修正，改同文件的 `PATIENT_FIELDS`（键是设计器"病人信息"面板上的中文名）。
