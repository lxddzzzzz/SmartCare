// designer_shoot.js — 在真实 easyform 设计器里导入 JSON 并截图（只导入不保存，不写库）
// 用法: node designer_shoot.js <表单.json> <输出.png>
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const JSONFILE = process.argv[2];
const OUT = process.argv[3] || 'designer_shot.png';
const DESIGNER = 'http://127.0.0.1:60000/eaxy-form.html';

(async () => {
  const browser = await chromium.connectOverCDP(process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];

  let page = ctx.pages().find((p) => p.url().includes('eaxy-form'));
  if (!page) {
    page = await ctx.newPage();
    await page.goto(DESIGNER, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }
  console.log('设计器页面:', page.url());
  await page.bringToFront();
  await page.waitForTimeout(800);

  // 设定视口，保证整张 A4（794×1123）完整可见且不被裁剪
  await page.setViewportSize({ width: 1920, height: 1400 }).catch(() => {});
  await page.waitForTimeout(500);

  // 关掉可能挡住的预览弹窗 / 对话框，避免导入被拦截
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(600);

  const before = await page.evaluate(() => ({
    files: document.querySelectorAll('input[type=file]').length,
    canvasChildren: [...document.querySelectorAll('*')].filter((e) => /comp|widget|item/i.test(e.className || '')).length,
  }));
  console.log('导入前:', JSON.stringify(before));

  // 导入 JSON（纯前端操作，不触发保存接口）
  await page.setInputFiles('input[type=file]', path.resolve(JSONFILE));
  await page.waitForTimeout(5500);

  const after = await page.evaluate(() => {
    const body = (document.body.innerText || '').replace(/\s+/g, ' ');
    const big = [...document.querySelectorAll('*')].map((e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { tag: e.tagName, cls: String(e.className || '').slice(0, 70), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor, pos: cs.position };
    }).filter((o) => o.w > 350 && o.h > 300);
    return {
      nameInputs: [...document.querySelectorAll('input[type=text]')].map((i) => i.value).slice(0, 8),
      dialogs: [...document.querySelectorAll('.ant-modal, .ant-message, nz-message, .ant-notification')].map((e) => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 120)),
      bigBoxes: big.slice(0, 20),
      text: body.slice(0, 260),
      viewport: { w: innerWidth, h: innerHeight },
    };
  });
  console.log('\n导入后 表单名输入框:', JSON.stringify(after.nameInputs));
  console.log('导入后 提示/弹窗:', JSON.stringify(after.dialogs));
  console.log('视口:', JSON.stringify(after.viewport));
  console.log('\n大尺寸容器:');
  after.bigBoxes.forEach((b) => console.log(`  ${b.tag} .${b.cls} @(${b.x},${b.y}) ${b.w}x${b.h} bg=${b.bg} pos=${b.pos}`));
  console.log('\n页面文本片段:', after.text);

  await page.screenshot({ path: path.resolve(OUT) });
  console.log('\n✓ 整页截图:', path.resolve(OUT));
  // 纸张区域截图：★ 不能用 elementHandle.screenshot / page.screenshot({clip})
  //   设计器画布会按视口缩放（pxScale = clientWidth/1920*16），元素截图坐标会错位（实测偏 50px）。
  //   可靠做法：截整页 → 用 crop_paper.ps1 按画布底色(#E3EBF6)自动定位纸张后裁剪。
  const paperOut = path.resolve(OUT).replace(/\.png$/i, '_纸张.png');
  console.log('\n下一步（自动定位纸张并裁剪）：');
  console.log(`  & ".\\crop_paper.ps1" -In "${path.basename(path.resolve(OUT))}" -Out "${path.basename(paperOut)}"`);
  // 不调用 browser.close()，避免关闭用户浏览器
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
