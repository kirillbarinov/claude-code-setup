#!/usr/bin/env node
// motion.mjs <url> <outdir> [--width 1440] [--hero 3000] [--scroll 4000] [--name motion] [--act "<сел>"]
// Пишет вход героя и скролл-проход без reduced-motion, режет контакт-листы ffmpeg'ом,
// сравнивает кадр reduced-motion с последним кадром входа (PSNR), считает длинные кадры и CLS.
// --act "<сел>" — после окна героя кликает по узлу и пишет ещё --hero мс: контакт-лист
// сигнатурного момента режима «продукт», который отвечает на действие, а не на загрузку.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { warm } from './warm.mjs';
const require = createRequire('/opt/homebrew/lib/node_modules/@playwright/test/');
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const pos = []; const flags = {};
// Принимает и `--k v`, и `--k=v`: qa.mjs требует вторую форму для --design=, и
// набор флагов инструментов должен читаться единообразно.
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else flags[a.slice(2)] = argv[++i];
  } else pos.push(a);
}
const [url, outdir] = pos;
if (!url || !outdir) { console.error('motion.mjs <url> <outdir> [--width 1440] [--hero 3000] [--scroll 4000] [--name motion] [--act "<сел>"] [--force]'); process.exit(2); }
const W = Number(flags.width || 1440), H = 900;
const HERO = Number(flags.hero || 3000), SCROLL = Number(flags.scroll || 4000);
const NAME = flags.name || 'motion';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const T0 = Date.now();
const dbg = m => { if (flags.debug) console.error(`[motion ${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`); };
if (!fs.existsSync(FFMPEG)) { console.error('MOTION_FAIL: нет ffmpeg по пути ' + FFMPEG); process.exit(3); }
fs.mkdirSync(outdir, { recursive: true });
const out = s => path.join(outdir, `${NAME}-motion-${W}${s}`);
if (!flags.force) {
  const busy = ['-hero.png', '-scroll.png', '-act.png', '.json'].map(out).filter(f => fs.existsSync(f));
  if (busy.length) { console.error('MOTION_FAIL: файлы раунда уже есть, возьми другой --name или добавь --force:\n' + busy.join('\n')); process.exit(4); }
}

const INIT = () => {
  window.__m = { deltas: [], cls: 0 };
  let last = performance.now();
  const tick = t => { window.__m.deltas.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  } catch {}
};

// scrollHeight пересчитывается на каждом кадре, а не берётся один раз до прохода:
// ScrollTrigger-пиновка и подгрузка контента меняют высоту документа по ходу скролла.
const SMOOTH_SCROLL = async ms => {
  // html{scroll-behavior:smooth} превращает каждый scrollTo в плавную анимацию, и проход не доезжает — глушим на время съёмки
  const st = document.createElement('style');
  st.textContent = 'html,body,*{scroll-behavior:auto !important}';
  document.head.appendChild(st);
  const t0 = performance.now();
  await new Promise(res => {
    const f = t => {
      const p = Math.min(1, (t - t0) / ms);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const H = document.documentElement.scrollHeight - innerHeight;
      scrollTo({ top: H * e, behavior: 'instant' });
      p < 1 ? requestAnimationFrame(f) : res();
    };
    requestAnimationFrame(f);
  });
};

// Lenis перехватывает нативный scrollTo и не движется от него — со страницей на Lenis
// (стек §5.4 «кино») проход ведёт колесо (page.mouse.wheel), не JS-скролл.
const HAS_LENIS = () => !!(window.lenis || window.__lenis);
const driveScroll = async (page, ms) => {
  const hasLenis = await page.evaluate(HAS_LENIS);
  if (!hasLenis) { await page.evaluate(SMOOTH_SCROLL, ms); return; }
  const STEP_MS = 50;
  const steps = Math.max(1, Math.round(ms / STEP_MS));
  for (let i = 0; i < steps; i++) {
    const remaining = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY);
    if (remaining > 0) await page.mouse.wheel(0, remaining / (steps - i));
    await page.waitForTimeout(STEP_MS);
  }
};

const ff = (args, step) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`MOTION_FAIL: ffmpeg ${step}\n${r.stderr || ''}`);
  return r;
};
const sheet = (video, ssMs, durMs, file, step) => {
  const fps = 12 / (durMs / 1000);
  ff(['-ss', String(ssMs / 1000), '-t', String(durMs / 1000), '-i', video, '-vf', `fps=${fps},scale=480:-1,tile=3x4`, '-frames:v', '1', file], step);
};
const frameAt = (video, ssMs, file, step) => ff(['-ss', String(ssMs / 1000), '-i', video, '-frames:v', '1', file], step);
// ffmpeg при `-f null -` завершается кодом 0 и пишет статистику PSNR в stderr —
// execFileSync при коде 0 отдаёт только stdout и теряет её, поэтому здесь только spawnSync.
const psnr = (a, b) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /average:(inf|[\d.]+)/.exec((r.stderr || '') + (r.stdout || ''));
  return m ? (m[1] === 'inf' ? 99 : Number(m[1])) : null;
};

const browser = await chromium.launch();
// Сторож на весь запуск: зависший шаг (сеть, decode, видео) даёт MOTION_FAIL, а не вечное ожидание.
const BUDGET = HERO * 3 + SCROLL + 60000;
const watchdog = setTimeout(() => { console.error(`MOTION_FAIL: запуск не завершился за ${BUDGET} мс (включи --debug, чтобы увидеть последний шаг)`); browser.close().catch(() => {}); process.exit(5); }, BUDGET);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));

// Всё, что пишет в tmp и держит браузер открытым, — под try/finally: если что-то
// внутри бросит (например page.goto), браузер и временная папка с .webm не должны
// осиротеть — иначе к каждому упавшему прогону остаётся зомби-Chromium и лишний видеофайл.
try {
  // --- 1. запись без reduced-motion
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: 'no-preference', recordVideo: { dir: tmp, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  const videoStart = Date.now();
  await page.addInitScript(INIT);
  await page.goto(url, { waitUntil: 'networkidle' }); dbg('goto');
  await warm(page); dbg('warm');
  await page.reload({ waitUntil: 'commit' }); dbg('reload');
  const heroStart = Date.now() - videoStart;
  await page.waitForTimeout(HERO);

  // --- 1б. опциональный акт: клик по сигнатурному узлу, ещё --hero мс записи
  let actStart = null;
  if (flags.act) {
    const el = await page.$(flags.act);
    if (!el) throw new Error(`MOTION_FAIL: act selector not found: ${flags.act}`);
    actStart = Date.now() - videoStart;
    await el.click();
    await page.waitForTimeout(HERO);
  }

  const scrollStart = Date.now() - videoStart; dbg('hero done, scroll start');
  await Promise.race([
    driveScroll(page, SCROLL),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`MOTION_FAIL: скролл-проход не завершился за ${SCROLL + 5000} мс`)), SCROLL + 5000)),
  ]);
  dbg('scroll done');
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => window.__m); dbg('metrics');
  const video = page.video();
  // Playwright дописывает и финализирует .webm только после закрытия контекста —
  // path() до close() может вернуть путь к ещё не дописанному файлу.
  await ctx.close();
  const webmTmp = await video.path();
  const webm = out('.webm');
  // .webm должен остаться рядом с PNG в outdir, а не в tmp, который ниже удаляется
  // целиком, и JSON не должен указывать на файл, которого через секунду не будет.
  try { fs.renameSync(webmTmp, webm); }
  catch { fs.copyFileSync(webmTmp, webm); fs.unlinkSync(webmTmp); }

  dbg('webm saved');
  sheet(webm, heroStart, HERO, out('-hero.png'), 'hero sheet');
  sheet(webm, scrollStart, SCROLL, out('-scroll.png'), 'scroll sheet');
  if (flags.act) sheet(webm, actStart, HERO, out('-act.png'), 'act sheet');
  const lastHero = path.join(tmp, 'hero-last.png');
  frameAt(webm, heroStart + HERO - 250, lastHero, 'last hero frame');

  // --- 2. прогон с reduced-motion: конечный кадр обязан совпасть с концом входа
  dbg('sheets done');
  const ctx2 = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  await p2.goto(url, { waitUntil: 'networkidle' });
  await warm(p2);
  await p2.reload({ waitUntil: 'commit' });
  await p2.waitForTimeout(HERO);
  await p2.screenshot({ path: out('-reduced.png') });
  await ctx2.close(); dbg('reduced done');

  const deltas = m.deltas.slice(1);
  const reducedPsnr = psnr(lastHero, out('-reduced.png'));
  const result = {
    url, width: W, heroMs: HERO, scrollMs: SCROLL,
    longFrames: deltas.filter(d => d > 50).length,
    maxFrameMs: Math.round(Math.max(0, ...deltas)),
    cls: Number(m.cls.toFixed(3)),
    reducedPsnr, reducedMatch: reducedPsnr !== null && reducedPsnr >= 30,
    video: webm,
    act: flags.act ? { selector: flags.act, frames: 12 } : null,
  };
  fs.writeFileSync(out('.json'), JSON.stringify(result, null, 2));
  console.log(`motion ${W}: длинных кадров ${result.longFrames} (макс ${result.maxFrameMs} мс), CLS ${result.cls}, reduced ${result.reducedMatch ? 'совпал' : 'НЕ СОВПАЛ'} (PSNR ${reducedPsnr})`);
  console.log(out('-hero.png')); console.log(out('-scroll.png')); console.log(out('-reduced.png'));
  if (flags.act) console.log(out('-act.png'));
  console.log(out('.json'));
} finally {
  clearTimeout(watchdog);
  await browser.close().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}
