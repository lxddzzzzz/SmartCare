// pdf_shot.js — 用 Chrome 渲染「Word 原生导出的 PDF」并截图（保真基准，避免 HTML 导出失真）
// 用法: node pdf_shot.js <file.pdf> <out.png>
const path = require('path');
const { chromium } = require('playwright-core');

const PDF = process.argv[2];
const OUT = process.argv[3];

(async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1000, height: 1400 }).catch(() => {});
  const url = 'file:///' + path.resolve(PDF).replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(6000);          // 等 PDF viewer 渲染完
  await page.screenshot({ path: path.resolve(OUT) });
  console.log('✓ 保真截图:', path.resolve(OUT));
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
