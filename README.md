# SmartCare 实施工具集

这个仓库收集 SmartCare 重症系统实施过程中沉淀下来的实用工具，都是踩过坑之后写出来的。

## 工具列表

### [easyform-docx2json](easyform-docx2json/) — Word 文书转表单 JSON

把客户给的 **Word 临床文书（`.docx`）直接转成 easyform 设计器「导入 json 文件」能吃的 JSON**，
省掉在设计器里手工拖上百个组件。

一张 A4 的护理评估表有 200+ 个组件、40+ 个勾选框，手工拖一遍要半天，还容易漏框、压叠。
这个工具把「Word 版式 → 设计器组件」这件事自动化，并对齐了真设计器的几何规范与字段命名规范。

**实测效果**（同一份《分娩镇痛麻醉评估与记录》）：

| 指标 | 传统手工 | 本工具 |
|---|---|---|
| 组件数 | 94 | **212** |
| 勾选框 | 3 | **45（全量）** |
| 题组 | 3（全撞名） | **11 组** |
| 患者字段 | 1（取不到值） | **6，绑定正确** |
| 重叠 | 3 处 | **0** |
| A4 填充率 | 91% | **99%** |

**快速开始**

```bash
git clone https://github.com/lxddzzzzz/SmartCare.git
cd SmartCare/easyform-docx2json
npm install
node easyform-docx2json.js "你的文书.docx" --out 生成结果
```

详细用法见 [easyform-docx2json/README.md](easyform-docx2json/README.md)。

## 环境要求

- Node.js >= 16
- 部分截图脚本需要 Playwright，连接凭据一律走环境变量（见各工具说明）

## 说明

本仓库为个人实施经验沉淀，与系统厂商无隶属关系。代码中的客户名称、内网地址、数据库凭据均已在发布前清除。

## 许可

[MIT](easyform-docx2json/LICENSE)
