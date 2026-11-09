// Полная расшифровка через NoteGPT: вставить ссылку, дождаться, прокрутить панель, собрать строки с таймкодами.
import { chromium } from '/opt/homebrew/lib/node_modules/@playwright/test/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--mute-audio'] });
for (const id of process.argv.slice(2)) {
  const ctx = await browser.newContext({ acceptDownloads: false });
  const page = await ctx.newPage();
  page.on('popup', p => p.close().catch(() => {}));
  try {
    await page.goto('https://notegpt.io/youtube-transcript-generator', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);
    const input = page.locator('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea').first();
    await input.fill('https://www.youtube.com/watch?v=' + id);
    await input.press('Enter');
    await page.waitForFunction(() => /\d\d:\d\d/.test(document.body.innerText) && document.body.innerText.includes('Transcript'), null, { timeout: 120000 });
    await page.waitForTimeout(8000);
    // прокрутить все прокручиваемые панели до конца (на случай ленивой подгрузки)
    const seen = new Map();
    for (let i = 0; i < 80; i++) {
      const done = await page.evaluate(() => {
        let moved = false;
        for (const el of document.querySelectorAll('*')) {
          if (el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
            const before = el.scrollTop; el.scrollTop += el.clientHeight; if (el.scrollTop !== before) moved = true;
          }
        }
        return !moved;
      });
      const lines = await page.evaluate(() => document.body.innerText.split('\n'));
      for (let j = 0; j < lines.length; j++) if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(lines[j].trim()) && lines[j + 1]) seen.set(lines[j].trim(), lines[j + 1].trim());
      if (done) break;
      await page.waitForTimeout(400);
    }
    const title = await page.evaluate(() => document.body.innerText.split('\n').map(s => s.trim()).find(s => s.length > 15 && !/Off|Upgrade|Back/.test(s)));
    const raw = await page.evaluate(() => document.body.innerText);
    let text = [...seen].map(([t, s]) => `[${t}] ${s}`).join('\n');
    fs.writeFileSync(`${id}.notegpt.raw.txt`, raw);
    fs.writeFileSync(`${id}.txt`, `# ${title}\nurl: https://youtu.be/${id}\nsource: notegpt.io\n\n## Расшифровка\n${text}\n`);
    console.log(id, 'OK segments', seen.size, 'chars', text.length, 'raw', raw.length, '|', title);
  } catch (e) { console.log(id, 'FAIL', e.message.split('\n')[0]); await page.screenshot({ path: `ng_${id}_fail.png` }).catch(() => {}); }
  await ctx.close();
}
await browser.close();
