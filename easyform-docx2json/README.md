# easyform-docx2json

[![Node](https://img.shields.io/badge/node-%3E%3D16-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

把客户给的 **Word 临床文书（`.docx`）直接转成 easyform 设计器「导入 json 文件」能吃的 JSON**，
省掉在设计器里手工拖上百个组件。

> 起因：一张 A4 的护理评估表有 200+ 个组件、40+ 个勾选框，手工拖一遍要半天，还容易漏框、压叠。
> 这个工具把「Word 版式 → 设计器组件」这件事自动化，并对齐了真设计器的几何规范与字段命名规范。

---

## 特性

- **忠实还原版式**：段落、表格、下划线空白位、勾选框、签名栏、日期栏按原 Word 位置还原，自动折行、超页分页
- **勾选框不丢**：`□` 全部转为 `checkBox` 并按题组共享 `value`（实测 45/45 转换，残留 0）
- **字段名可读**：患者信息绑权威字段表（`patient.gender` / `patient.mrn` …）+ 语义词典 + 拼音兜底，全局唯一化
- **对齐真设计器**：几何单位、页边距、CJK 字符宽度、`multiSelect` 落值等均按真设计器实测校准
- **自带质检**：转换后可用 `check_json.js` / `validate_json.js` 检查残余勾选框、字段重复、重叠、越界、填充率

## 快速开始

```bash
git clone <本仓库地址>
cd easyform-docx2json
npm install

node easyform-docx2json.js "你的文书.docx" --out 生成结果
```

不想敲命令：**把 `.docx` 直接拖到 `转换.bat` 上**即可。

然后打开设计器 → 顶部「导入 json 文件」→ 选生成的 `.json` → 点「保存表单」。

### 命令行参数

| 参数 | 说明 |
|---|---|
| `--formName 名称` | 表单显示名（默认取文件名第一段） |
| `--formCode 代码` | 表单代码（默认取文件名第二段，没有就用表单名拼音） |
| `--hospitalName 医院` | 医院名（仅记录用，默认取文件名第三段） |
| `--out 目录` | 输出目录（默认与 docx 同目录） |

支持一次传多个 `.docx`。文件名建议：`表单名__表单代码__医院名.docx`。

### 产物

| 文件 | 说明 |
|---|---|
| `<表单代码>.json` | ★ 设计器导入用的成品 |
| `<表单代码>.unknown.txt` | 未命中词典的中文标签（补到 `lib/field-map.js` 的 `FORM_HINTS` 可改善字段名） |
| `*.preview.html` | 可视化预览（`node preview_html.js x.json` 生成），不开设计器也能核对版式 |

## 自检工具

```bash
node check_json.js    x.json   # 残留勾选框 / 题组 / 字段重复 / 重叠 / 越界 / 填充率
node validate_json.js x.json   # 几何、字段名、主键健全性校验
node validate_json.js x.json 设计器真实导出.json   # 额外做字段集比对
node dump_layout.js   x.json --cm   # 把 JSON 还原成"按行文本预览"
node diag.js          x.json   # 诊断相邻行间距
node compare_with_docx.js 原文档.docx x.json   # 逐行核对内容有无丢失
```

## 转换规则概要

**文字 → 组件**

| Word 里的形态 | 转成 |
|---|---|
| 普通文字 | `label`（标题自动居中加粗） |
| 下划线空白 `____` | `textField`（下划线式） |
| `□` + 选项文字 | `checkBox`（同题组共享 `value`，各自 `code` = 选项拼音） |
| 含"签名/签字"的空白 | `ca-signature` |
| 含"时间/日期"的空白 | `modalDatePicker` |
| `____年__月__日` | 3 个 `textField`（忠实还原原版式） |
| 表格 | 每行一个 `table` 组件 + 单元格内文字/输入框，超宽等比缩放 |

**几何规范**（均在真设计器里实测校准，详见 `README_使用说明.md`）：

- 内部用 cm 计算，输出 `rem = cm × 2.3622`；1rem = 12pt，A4 = 49.6rem × 70.16rem
- 页边距 5mm；行高 = 字号 × 1.42；组件高 = 字号 × 1.32
- CJK 实际宽度 ≈ 1.10em（不是 1em），ASCII ≈ 0.62em —— 按 1em 算会导致标签折行
- `isNoBorder:true` 会让下划线变**透明**，要下划线必须 `false`

## 实测对比

同一份《分娩镇痛麻醉评估与记录》，与既有工具链相比：

| 指标 | 既有工具链 | 本工具 |
|---|---|---|
| 组件数 | 94 | **212** |
| 勾选框 | 3 | **45（全量）** |
| 题组 | 3（全撞名） | **11 组** |
| 患者字段 | 1（且取不到值） | **6，绑定正确** |
| 真重复字段 | — | **0** |
| 重叠 | 3 处 | **0** |
| A4 填充率 | 91% | **99%** |

## 目录结构

```
easyform-docx2json/
├─ easyform-docx2json.js    ★ 入口：docx → 设计器 JSON
├─ 转换.bat                  拖拽 .docx 到它上面即可转换
├─ preview_html.js           生成 HTML 版式预览
├─ check_json.js             质检（勾选框/题组/重复/重叠/越界/填充率）
├─ validate_json.js          几何与字段集校验
├─ dump_layout.js            把 JSON 还原成按行文本预览
├─ diag.js                   行间距诊断
├─ compare_with_docx.js      与原 Word 逐行核对
├─ probe_docx.js             探测 docx 结构
├─ lib/
│   ├─ docx-reader.js        .docx → 保序中间模型
│   ├─ field-map.js          中文标签 → 字段名（患者权威表 + 词典 + 拼音）
│   ├─ layout.js             ★ 语义核心：token→clause→atom→折行排布
│   └─ form-builder.js       组件规范化 + 表格还原 + 顶层装配
└─ 生成结果/                  产物（已被 .gitignore 忽略）
```

## 可选脚本的环境变量

`fix_id.js`（把数据库真实 `_id` 写进产物）、`designer_shoot.js` / `pdf_shot.js` / `watch.js`（CDP 连浏览器截图）
需要连接你**自己的**环境，配置一律走环境变量，不要把凭据写进代码：

```bash
export MONGODB_URI='mongodb://user:pass@127.0.0.1:27017/SmartCare'   # fix_id.js
export CDP_ENDPOINT='http://127.0.0.1:9222'                          # 其余截图脚本
```

## 已知限制

1. 只支持 `.docx`（`.doc` 请先另存为 `.docx`）；图片、页眉页脚、文本框内容不处理
2. 复杂表格：只处理单层表格；`vMerge` 纵向合并识别为 `restart`，跨页拆表未做
3. 超页时按"文档块"分页，整张表格不会被劈到两页，但极长表格可能超出一页
4. 选项与标签的切分依赖中文排版启发式，个别粘连（如 `□右侧卧位穿刺间隙：`）需导入后手工拆一下
5. 极少数装饰性横线可能超出画布边界（`line` 组件 x<0 或右溢出），不影响表单数据

## 许可

[MIT](LICENSE)
