#!/usr/bin/env node
// Отпечаток работы и сверка с тем, что уже делалось раньше — в ДРУГИХ проектах.
//   fingerprint.mjs <URL> [--name <имя проекта>] [--write] [--json] [--seen <путь>]
//
// Зачем отдельный инструмент, а не проба в qa.mjs. qa.mjs отвечает на вопрос «есть ли дефект на этой
// странице». Однотипность — не дефект страницы: симметричная сетка одинаковых карточек проходит все
// все пробы идеально. Это свойство СЕРИИ, и увидеть его можно только сравнив работу с предыдущими.
// Поэтому здесь нет провалов и кода выхода 1: инструмент печатает похожесть и уходит. Решение —
// за автором.
//
// Отпечаток намеренно короткий: шрифты, тема, акцент, радиус, шкала кеглей, макро-раскладка.
// Это ровно те шесть вещей, по которым посетитель узнаёт «я это уже видел», и ни одной больше:
// длинный отпечаток совпадает всегда и потому ничего не значит.
import { createRequire } from 'node:module';
import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire('/opt/homebrew/lib/node_modules/@playwright/test/');
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { try { ({ chromium } = require('playwright')); }
catch { console.error('Нет playwright. Установи: npm i -g @playwright/test'); process.exit(2); } }

const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith('--'));
if (!url) {
  console.error('fingerprint.mjs <URL> [--name <имя>] [--write] [--json] [--seen <путь>]');
  process.exit(2);
}
const flag = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : (args.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1]; };
let NAME = flag('name') || '';
const WRITE = args.includes('--write');
const AS_JSON = args.includes('--json');
const SEEN = flag('seen') || join(homedir(), '.local/share/design-skills/SEEN.md');

// ── сбор отпечатка ──────────────────────────────────────────────────────────
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
} catch {
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
  catch (e) { console.error('Страница не открылась:', e.message); await browser.close(); process.exit(3); }
}
await page.waitForTimeout(600);

/* Имя записи — это ключ, по которому работа узнаёт саму себя при следующем прогоне. Без `--name`
   в него уходил URL, а URL у локальной пробы случайный: `http://127.0.0.1:8749/index.html` сегодня
   и другой порт завтра. В SEEN.md от этого копится один и тот же проект под разными именами, и
   фильтр самосравнения перестаёт его узнавать: работа начинает сравниваться со вчерашней собой и
   честно докладывать «почти то же самое». Поэтому имя берём из `<title>` — оно живёт вместе со
   страницей, а не с адресом раздачи. Берём первый сегмент до « — » / « | »: в титуле обычно
   «Из Морозки — каталог», а проект один и тот же на всех страницах. */
if (!NAME) {
  NAME = await page.evaluate(() =>
    (document.title || '').split(/\s+[—–|·]\s+/)[0].trim().slice(0, 60)).catch(() => '');
}

const fp = await page.evaluate(() => {
  const px = v => parseFloat(v) || 0;
  const rgb = s => { const m = String(s).match(/-?[\d.]+/g); return m && m.length >= 3 && (m.length < 4 || px(m[3]) > 0.05) ? [+m[0], +m[1], +m[2]] : null; };
  const hex = c => '#' + c.map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
  const hsl = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  };

  const all = [...document.querySelectorAll('*')].slice(0, 4000);
  const bgArea = new Map(), inkCount = new Map(), fams = new Map(), radii = new Map();
  const sizes = [];
  let biggest = null, biggestSize = 0;

  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || px(cs.opacity) < 0.05) continue;

    const bg = rgb(cs.backgroundColor);
    if (bg) bgArea.set(hex(bg), (bgArea.get(hex(bg)) || 0) + r.width * r.height);

    const rad = Math.round(px(cs.borderTopLeftRadius));
    if (rad > 0) radii.set(rad, (radii.get(rad) || 0) + 1);

    // кегль, вес, семейство и цвет текста берутся только у элементов с собственным текстом:
    // иначе они наследуются вниз по дереву и любой отпечаток становится «весь набор сразу».
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;

    const fam = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
    if (fam) fams.set(fam, (fams.get(fam) || 0) + r.width * r.height);

    const ink = rgb(cs.color);
    if (ink) inkCount.set(hex(ink), (inkCount.get(ink ? hex(ink) : '') || 0) + 1);

    const fs = Math.round(px(cs.fontSize));
    if (fs) sizes.push(fs);
    if (fs > biggestSize) { biggestSize = fs; biggest = el; }
  }

  const top = (m, n = 2) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
  const pageBg = getComputedStyle(document.body).backgroundColor;
  const bg = rgb(pageBg) || rgb(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255];

  // Акцент — самый насыщенный из заметных фонов, а не самый частый: акцент по определению редок.
  let accent = null, bestChroma = -1;
  for (const [h, area] of bgArea) {
    if (area < 200) continue;
    const c = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const [, s, l] = hsl(c);
    if (s < 15 || l < 6 || l > 94) continue;
    if (s > bestChroma) { bestChroma = s; accent = h; }
  }

  const uniqSizes = [...new Set(sizes)].sort((a, b) => a - b);
  const base = uniqSizes.length ? (sizes.slice().sort((a, b) => sizes.filter(v => v === a).length - sizes.filter(v => v === b).length).pop() || 16) : 16;
  const scale = uniqSizes.length ? +(Math.max(...uniqSizes) / Math.max(1, base)).toFixed(2) : 1;

  // Макро-раскладка: центрирован ли главный заголовок и сколько равных блоков стоят в самом широком ряду.
  let heroCenter = false;
  if (biggest) {
    const cs = getComputedStyle(biggest);
    const r = biggest.getBoundingClientRect();
    const pr = (biggest.parentElement || document.body).getBoundingClientRect();
    const left = r.left - pr.left, right = pr.right - r.right;
    heroCenter = cs.textAlign === 'center' || (pr.width > 200 && left > 8 && Math.abs(left - right) < pr.width * 0.06);
  }

  let row = 0;
  for (const el of all) {
    const kids = [...el.children].filter(k => { const b = k.getBoundingClientRect(); return b.width > 40 && b.height > 40; });
    if (kids.length < 2) continue;
    const groups = new Map();
    for (const k of kids) {
      const b = k.getBoundingClientRect();
      const key = `${Math.round(b.width / 4)}:${Math.round(b.top / 4)}`;
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    row = Math.max(row, ...groups.values());
  }

  const [, , bgL] = hsl(bg);
  return {
    fonts: top(fams, 2),
    theme: bgL < 45 ? 'dark' : 'light',
    bg: hex(bg),
    ink: top(inkCount, 1)[0] || '#000000',
    accent: accent || '—',
    radius: top(radii, 1)[0] ?? 0,
    scale,
    hero: heroCenter ? 'center' : 'left',
    row: row < 2 ? 0 : row,
  };
});
await browser.close();

// ── сверка с прошлыми работами ──────────────────────────────────────────────
const parse = line => {
  const g = k => (line.match(new RegExp(`${k}:\\s*([^·]+)`)) || [])[1]?.trim();
  const date = (line.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
  if (!date) return null;
  const name = (line.match(/·\s*([^·]+?)\s*·\s*fonts:/) || [])[1]?.trim() || '?';
  return {
    date, name,
    fonts: (g('fonts') || '').split('+').map(s => s.trim()).filter(Boolean),
    theme: g('theme') || '', bg: g('bg') || '', accent: g('accent') || '',
    radius: parseInt(g('radius') || '0', 10) || 0,
    scale: parseFloat(g('scale') || '0') || 0,
    hero: g('hero') || '', row: parseInt(g('row') || '0', 10) || 0,
  };
};

const hueOf = h => {
  if (!/^#[0-9a-f]{6}$/i.test(h)) return null;
  const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mx = Math.max(...c), mn = Math.min(...c), d = mx - mn;
  if (!d) return null;
  const [r, g, b] = c;
  let x = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (x * 60 + 360) % 360;
};

const score = (a, b) => {
  const setA = new Set(a.fonts.map(s => s.toLowerCase())), setB = new Set(b.fonts.map(s => s.toLowerCase()));
  const inter = [...setA].filter(f => setB.has(f)).length;
  const uni = new Set([...setA, ...setB]).size || 1;
  const fonts = inter / uni;

  const theme = a.theme === b.theme ? 1 : 0;

  const ha = hueOf(a.accent), hb = hueOf(b.accent);
  let accent = 0.5;
  if (ha != null && hb != null) { const d = Math.abs(ha - hb); accent = 1 - Math.min(1, Math.min(d, 360 - d) / 90); }
  else if (a.accent === '—' && b.accent === '—') accent = 1;

  const layout = ((a.hero === b.hero ? 0.5 : 0) + (a.row && a.row === b.row ? 0.5 : a.row === b.row ? 0.3 : 0));
  const shape = (Math.abs(a.radius - b.radius) <= 2 ? 0.5 : 0) + (a.scale && b.scale && Math.abs(a.scale - b.scale) <= 0.2 ? 0.5 : 0);

  const s = 0.32 * fonts + 0.10 * theme + 0.22 * accent + 0.24 * layout + 0.12 * shape;
  const parts = [];
  if (fonts > 0) parts.push(`шрифты (${[...setA].filter(f => setB.has(f)).join(', ')})`);
  if (theme) parts.push(`тема ${a.theme}`);
  if (accent > 0.7) parts.push(`акцент ${b.accent}`);
  if (a.hero === b.hero) parts.push(`hero ${a.hero}`);
  if (a.row && a.row === b.row) parts.push(`${a.row} блока в ряд`);
  if (Math.abs(a.radius - b.radius) <= 2) parts.push(`радиус ${b.radius}px`);
  return { s: +s.toFixed(2), parts };
};

const lines = existsSync(SEEN) ? readFileSync(SEEN, 'utf8').split('\n').filter(l => l.trim().startsWith('- ')) : [];
const all = lines.map(parse).filter(Boolean);

/* Однотипность — это похожесть на ЧУЖИЕ работы, а не на собственные прошлые прогоны. Пока фильтра
   не было, повторный запуск по тому же проекту находил его же вчерашнюю запись и честно объявлял
   «почти то же самое: совпали шрифты, акцент и раскладка» — совет при этом был бессмысленный
   («смени решение»), потому что менять предлагалось относительно самого себя. Свои записи узнаём
   по имени проекта; без `--name` оно взято из `<title>` страницы — см. выше, почему не из URL. */
const self = (NAME || url).trim().toLowerCase();
const mine = all.filter(p => (p.name || '').trim().toLowerCase() === self);
const past = all.filter(p => (p.name || '').trim().toLowerCase() !== self);
const matches = past.map(p => ({ p, ...score(fp, p) })).filter(m => m.s >= 0.55).sort((a, b) => b.s - a.s).slice(0, 5);

const stamp = new Date().toISOString().slice(0, 10);
const row = `- ${stamp} · ${NAME || url} · fonts: ${fp.fonts.join(' + ') || '—'} · theme: ${fp.theme} · bg: ${fp.bg} · ink: ${fp.ink} · accent: ${fp.accent} · radius: ${fp.radius} · scale: ${fp.scale} · hero: ${fp.hero} · row: ${fp.row}`;

console.log('ОТПЕЧАТОК');
console.log(`  ${row.slice(2)}`);
console.log(`  записей для сравнения: ${past.length}${mine.length ? ` (плюс ${mine.length} своих того же проекта — не в счёт)` : ''}`);
if (!past.length) {
  console.log('ПОХОЖЕСТЬ: сравнивать не с чем — в SEEN.md нет ни одной чужой работы. ' +
    'Отпечаток записан; смысл появится со второй-третьей работой.');
} else if (!matches.length) {
  console.log('ПОХОЖЕСТЬ: совпадений выше 0.55 нет — работа не повторяет предыдущие по этим шести осям.');
} else {
  console.log('ПОХОЖЕСТЬ (это не провал — это повод назвать причину или сменить решение):');
  for (const m of matches) {
    const verdict = m.s >= 0.80 ? 'почти то же самое' : m.s >= 0.65 ? 'узнаётся как та же рука' : 'перекликается';
    console.log(`  ${m.s} · ${verdict} · ${m.p.date} ${m.p.name}`);
    console.log(`        совпало: ${m.parts.join('; ') || '—'}`);
  }
  console.log('  Совпадение по шрифтам + акценту + раскладке одновременно — это и есть «выглядит как ИИ»:');
  console.log('  не потому, что плохо, а потому, что уже было. Осознанное повторение допустимо — назови причину в DESIGN.md.');
}

if (WRITE) {
  if (!existsSync(SEEN)) {
    writeFileSync(SEEN, `# SEEN — отпечатки уже сделанных работ\n\n` +
      `Ведёт \`_tools/fingerprint.mjs --write\`. Одна строка — одна сданная работа.\n` +
      `Файл нужен затем, чтобы средний вкус модели не воспроизводился от проекта к проекту: внутри\n` +
      `одного репозитория за этим следит §2в директора, а между репозиториями помнить больше нечему.\n` +
      `Строки не редактируются руками; устаревшие (проект переделан заново) — удаляются.\n\n`);
  }
  appendFileSync(SEEN, row + '\n');
  console.log(`\nЗаписано в ${SEEN}`);
} else {
  console.log('\nЗапись не сделана. Работа сдана — прогони с --write, чтобы следующий проект знал про эту.');
}

if (AS_JSON) console.log(JSON.stringify({ url, fingerprint: fp, matches: matches.map(m => ({ score: m.s, date: m.p.date, name: m.p.name, parts: m.parts })) }, null, 2));
