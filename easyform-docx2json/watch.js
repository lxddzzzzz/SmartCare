// watch.js — 持续监控设计器页面：console 报错 / 请求失败 / 每个 /http/ 请求体与响应体
// 用法: node watch.js           → 后台常驻，日志写到 生成结果/_watch.log
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const LOG = path.resolve('生成结果/_watch.log');
const LAST_REQ = path.resolve('生成结果/_last_request.json');

function w(line) {
  const s = `[${new Date().toISOString().slice(11, 19)}] ${line}\n`;
  try { fs.appendFileSync(LOG, s, 'utf8'); } catch (e) {}
  process.stdout.write(s);
}

(async () => {
  fs.writeFileSync(LOG, '', 'utf8');
  const browser = await chromium.connectOverCDP(process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes('eaxy-form'));
  if (!page) { console.error('未找到设计器页面（eaxy-form）'); process.exit(1); }

  w('================ 开始监控设计器 ================');
  w('页面: ' + page.url());

  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') w(`[console.${t}] ${m.text().slice(0, 600)}`);
  });
  page.on('pageerror', (e) => w(`[pageerror] ${String(e.message).slice(0, 600)}`));
  page.on('requestfailed', (r) => w(`[requestfailed] ${r.method()} ${r.url()} :: ${(r.failure() || {}).errorText}`));

  page.on('request', (r) => {
    if (!/\/http\//.test(r.url())) return;
    const pd = r.postData();
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    w(`[--> 发出] ${r.method()} ${r.url()}  body=${pd ? pd.length : 0} 字节`);
    if (pd) {
      // ★ 每次都单独存盘（不再相互覆盖），便于事后精确 diff 失败/成功两次的请求体
      try {
        fs.writeFileSync(LAST_REQ, pd, 'utf8');
        fs.writeFileSync(path.resolve(`生成结果/_req_${stamp}_${pd.length}.json`), pd, 'utf8');
      } catch (e) {}
    }
  });

  page.on('response', async (res) => {
    const u = res.url();
    if (!/\/http\//.test(u)) return;
    let body = '';
    try { body = (await res.text()).slice(0, 1500); } catch (e) { body = '<body 读取失败>'; }
    w(`[<-- 返回] ${res.status()} ${u}\n           ${body}`);
  });

  w('=== 监控中：请在设计器里操作（导入 JSON → 保存表单），按 Ctrl+C 结束 ===');
  setInterval(() => {}, 1 << 30);   // 常驻
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
