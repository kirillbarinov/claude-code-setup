#!/usr/bin/env node
// Проверка контраста по WCAG 2.1 — инструментом, а не на глаз.
//   contrast.mjs "#111111" "#f5f0e8"            — одна пара
//   contrast.mjs --design DESIGN.md             — пары из фронтматтера
// Порог: AA обычный текст 4.5, крупный (>=24px или >=19px bold) 3.0, UI-элементы/иконки 3.0, AAA 7.0.
//
// Приоритет источника пар:
//   1) блок `contrast_pairs:` во фронтматтере — ЯВНЫЙ список того, что реально встречается на странице.
//      Строки вида:  - primary on surface
//                    - "#171310 on #D9702B — CTA hover"
//      Имена берутся из блока цветов, hex можно писать напрямую; хвост после «—» идёт в подпись.
//   2) если блока нет — эвристика по именам токенов (фон/текст) и полное кросс-произведение.
//      Это ГИПОТЕЗА, а не истина: она умеет придумывать пары, которых на странице нет,
//      и не видит hover/инверсию. Вердикт сверяй с реальным использованием токена в коде.
import { readFileSync } from 'node:fs';

const hex2rgb = h => {
  let s = String(h).trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
};
const lum = rgb => {
  const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const verdict = r => {
  const t = [['AAA', 7], ['AA', 4.5], ['AA-large/UI', 3]].find(([, v]) => r >= v);
  return t ? `PASS ${t[0]}` : 'FAIL (<3.0 — не проходит нигде)';
};
const check = (fg, bg, label = '') => {
  const a = hex2rgb(fg), b = hex2rgb(bg);
  if (!a || !b) { console.log(`  ? ${label || fg + ' на ' + bg}: не hex, пропуск`); return null; }
  const r = ratio(a, b), v = verdict(r);
  console.log(`  ${v.startsWith('FAIL') ? '✗' : v === 'PASS AA-large/UI' ? '~' : '✓'} ${label || `${fg} на ${bg}`}: ${r.toFixed(2)}:1 — ${v}`);
  return r;
};

const args = process.argv.slice(2);
if (args[0] === '--design') {
  const file = args[1] || 'DESIGN.md';
  const src = readFileSync(file, 'utf8');
  const fm = src.split(/^---\s*$/m)[1] || '';
  const colors = {};
  for (const m of fm.matchAll(/^\s*([\w-]+)\s*:\s*["']?(#[0-9a-fA-F]{3,8})["']?/gm)) colors[m[1]] = m[2];

  // --- 1. Явные пары ---
  const pairsBlock = fm.match(/^[ \t]*contrast_pairs[ \t]*:[ \t]*\n((?:[ \t]*-[ \t]*.*\n?)+)/m);
  const resolve = tok => {
    const t = tok.trim().replace(/^["']|["']$/g, '');
    return /^#/.test(t) ? t : (colors[t] || colors[t.replace(/-/g, '_')] || null);
  };
  let pairs = [];
  if (pairsBlock) {
    for (const line of pairsBlock[1].split('\n')) {
      const raw = line.replace(/^[ \t]*-[ \t]*/, '').trim().replace(/^["']|["']$/g, '');
      if (!raw) continue;
      const [body, ...note] = raw.split(/\s+[—–-]{1,2}\s+/);
      const m = body.match(/^(\S+)\s+(?:on|на|over)\s+(\S+)$/i);
      if (!m) { console.log(`  ? не разобрал строку contrast_pairs: «${raw}» (ожидается «текст on фон»)`); continue; }
      const fg = resolve(m[1]), bg = resolve(m[2]);
      if (!fg || !bg) { console.log(`  ? неизвестный токен в «${raw}»`); continue; }
      pairs.push([fg, bg, `${m[1]} на ${m[2]}${note.length ? ' — ' + note.join(' — ') : ''}`]);
    }
  }

  if (pairs.length) {
    console.log(`Контраст по ${file} — явные пары из contrast_pairs (${pairs.length}):`);
    let fails = 0;
    for (const [f, b, l] of pairs) { const r = check(f, b, l); if (r !== null && r < 4.5) fails++; }
    console.log(fails ? `\n${fails} пар ниже AA (4.5:1). Крупный заголовок и UI-элементы ≥3.0 допустимы — остальное чинить.` : '\nВсе объявленные пары проходят AA.');
    process.exit(0);
  }

  // --- 2. Фолбэк: эвристика по именам ---
  const keys = Object.keys(colors);
  if (!keys.length) { console.log('Цветов в фронтматтере не найдено. Ожидается `имя: "#rrggbb"`.'); process.exit(1); }
  const isBg = k => /bg|background|surface|canvas|paper|base|card|panel/i.test(k);
  const isFg = k => /text|fg|foreground|ink|body|heading|muted|accent|primary|link|on-/i.test(k);
  const bgs = keys.filter(isBg), fgs = keys.filter(k => isFg(k) && !isBg(k));
  console.log(`Контраст по ${file}: блока contrast_pairs нет, работаю ЭВРИСТИКОЙ по именам (${fgs.length} текстовых × ${bgs.length} фоновых).`);
  console.log('  ! Это гипотеза: пары могут не существовать на странице, hover/инверсия не покрыты.');
  console.log('  ! Надёжнее объявить contrast_pairs: во фронтматтере — тогда проверяется ровно то, что есть в вёрстке.');
  if (!bgs.length || !fgs.length) { console.log('  не удалось разделить фон/текст по именам — проверь пары вручную: contrast.mjs "#fg" "#bg"'); process.exit(0); }
  let fails = 0;
  for (const b of bgs) for (const f of fgs) { const r = check(colors[f], colors[b], `${f} на ${b}`); if (r !== null && r < 4.5) fails++; }
  console.log(fails ? `\n${fails} пар ниже AA (4.5:1). Сначала проверь, существует ли пара в вёрстке, — потом чини палитру.` : '\nВсе пары проходят AA.');
} else if (args.length >= 2) {
  check(args[0], args[1]);
} else {
  console.log('usage: contrast.mjs "#fg" "#bg"  |  contrast.mjs --design DESIGN.md');
  process.exit(1);
}
