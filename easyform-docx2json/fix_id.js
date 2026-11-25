// fix_id.js — 把数据库里同名 code 的真实 _id 写进产物 JSON 的顶层 id
//   · 库里已有该 code  → id = 真实 _id（保存时走"更新"）
//   · 库里没有该 code  → 删除 id 字段（保存时走"新增"）
//
// 用法:
//   set MONGODB_URI=mongodb://<用户>:<密码>@<主机>:<端口>/SmartCare
//   node fix_id.js <产物.json> [更多.json ...]
//
// 注意: 连接串请用环境变量传入，不要写进代码里（否则会随仓库一起公开）。
const fs = require('fs');
const path = require('path');

const { MongoClient } = require('mongodb');

const URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'SmartCare';

(async () => {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.log('用法: node fix_id.js <产物.json> ...');
    console.log('需要先设置环境变量 MONGODB_URI，例如:');
    console.log('  set MONGODB_URI=mongodb://user:pass@127.0.0.1:27017/SmartCare');
    process.exit(1);
  }
  if (!URI) {
    console.error('缺少环境变量 MONGODB_URI。示例:');
    console.error('  set MONGODB_URI=mongodb://user:pass@127.0.0.1:27017/SmartCare');
    process.exit(1);
  }

  const c = new MongoClient(URI, { serverSelectionTimeoutMS: 8000 });
  await c.connect();
  const col = c.db(DB_NAME).collection('dFormPojo');

  for (const f of files) {
    const p = path.resolve(f);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const doc = await col.findOne({ code: j.code }, { projection: { _id: 1 } });
    const oldId = j.id;
    if (doc) {
      j.id = String(doc._id);
      console.log(`✓ ${path.basename(p)}`);
      console.log(`    code=${j.code}  库里已有 → id: ${oldId} → ${j.id}  （保存走更新）`);
    } else {
      delete j.id;
      console.log(`✓ ${path.basename(p)}`);
      console.log(`    code=${j.code}  库里没有 → 已删除 id（保存走新增）`);
    }
    fs.writeFileSync(p, JSON.stringify(j, null, 1), 'utf8');
  }

  await c.close();
  console.log('\n完成。现在导入设计器保存，顶层 id 就是正确的了。');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
