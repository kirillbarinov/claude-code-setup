#!/usr/bin/env node
// Регресс-набор для qa.mjs.
//
// Проб девять, файл один, и правка ради одной пробы легко делает слепой другую — так проба 9
// трижды молчала на дефекте, ради которого писалась. Здесь на каждую категорию провала лежит
// минимальная страница с этим дефектом и ровно одна заведомо чистая. Проба обязана увидеть свою
// фикстуру и обязана промолчать на чистой; всё остальное на фикстуре не проверяется — минимальная
// страница не идеальна, и требовать от неё ровного набора значило бы чинить фикстуру, а не пробу.
//
//   node selftest.mjs            — прогнать весь набор
//   node selftest.mjs сетка      — только фикстуру этой категории (+ чистую)

import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QA = path.join(HERE, 'qa.mjs');
const DIR = path.join(HERE, 'selftest');

const CASES = [
  ['clean',       null],
  ['p1-overflow', 'переполнение'],
  ['p2-contrast', 'контраст'],
  ['p3-focus',    'фокус'],
  ['p4-motion',   'reduced-motion'],
  ['p5-form',     'форма'],
  ['p6-figure',   'фигура'],
  ['p7-hint',     'подсказка'],
  ['p8-default',  'контрол'],
  ['p9-grid',     'сетка'],
  ['p10-console', 'консоль'],
  ['p11-style',   'разнобой'],
  ['p12-rank',    'ранг'],
  ['p13-edge',    'край'],
  ['p14-gap',     'ритм'],
  ['p15-lead',    'зачин'],
  ['p16-tap',     'мишень'],
  ['p17-rule',    'черта'],
  ['p18-ghost',   'заливка'],
  ['p19-minor',   'раскрывашка'],
  ['p20-lorem',   'рыба'],
  ['p21-fold',    'первый экран'],
  ['p22-mimic',   'мимикрия'],
  ['p23-rowedge', 'колонка'],
  ['p24-wstep',   'ряд'],
  ['p25-stack',   'столбик'],
  ['p26-gap',     'разряды'],
  ['p27-anchor',  'якорь'],
  ['p28-currency','валюта'],
  ['p29-badge',   'круг'],
  ['p30-hier',    'иерархия'],
  ['p31-field',   'поле'],
  ['p32-link',    'ссылка'],
  ['p33-clip',    'обрезка'],
  ['p34-wrap',    'перенос'],
  ['p35-inventory', 'инвентарь'],
  ['p36-motion',    'движение'],
  ['p37-structure', 'скелет'],
  ['p38-hover',     'состояние'],
  ['p39-shift',     'сдвиг'],
  ['p40-zoom',      'зум'],
  ['p41-layout',    'движение'],
  ['m3-kino',       null],
];

// qa.mjs перехватывает запросы страницы (route.fetch), а это умеет только http — file:// падает
// на первой же пробе. Поэтому фикстуры раздаются локальным сервером на случайном порту.
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.normalize(path.join(DIR, rel));
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
// Держим keep-alive дольше прогона: по умолчанию Node закрывает соединение через 5 с,
// а между двумя ширинами у qa.mjs пауза бывает длиннее — браузер шлёт запрос в уже
// закрытый сокет и получает ECONNRESET, который снаружи выглядел как «не вернул JSON».
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const run = dir => new Promise(res => {
  const url = `http://127.0.0.1:${PORT}/${dir}/index.html`;
  // Фикстура с собственным DESIGN.md (например m3-kino) тестирует пробы, которые
  // включаются только флагом --design= — без него сценарий, для которого она
  // написана, не выполняется вовсе.
  const designPath = path.join(DIR, dir, 'DESIGN.md');
  const qaArgs = fs.existsSync(designPath) ? [QA, url, `--design=${designPath}`, '--json'] : [QA, url, '--json'];
  const p = spawn(process.execPath, qaArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', d => (out += d));
  // stderr не глушим: без него срыв запуска браузера выглядел как «не вернул JSON»,
  // и причина — своя ли ошибка в пробе или не поднявшийся Chromium — не различалась
  p.stderr.on('data', d => (err += d));
  p.on('close', () => {
    const i = out.lastIndexOf('{\n  "url"');
    // Полный вывод срыва кладём на диск: в строке отчёта помещаются три строки,
    // а разбирать приходится всю трассу.
    if (i < 0) fs.writeFileSync(`/tmp/selftest-fail-${dir}.log`, out + '\n--- STDERR ---\n' + err);
    if (i < 0) return res({ err: 'qa.mjs не вернул JSON' + (err ? ': ' + (() => {
        const ls = err.trim().split('\n').filter(l => l.trim());
        // Ищем строку с настоящей причиной: последние две строки — это хвост
        // трассы («Node.js v20.19.5»), по которому ничего не понять.
        const k = ls.findIndex(l => /error|Error|throw|failed/.test(l));
        return (k >= 0 ? ls.slice(k, k + 3) : ls.slice(0, 3)).join(' / ').slice(0, 300);
      })() : '') });
    try { res(JSON.parse(out.slice(i))); } catch (e) { res({ err: e.message }); }
  });
});

// До трёх попыток на кейс с паузой между ними: запуск браузера срывается на ровном
// месте, когда машина занята (открытые dev-серверы, чужие headless-инстансы), и без
// повтора набор краснеет там, где проба ни при чём. Пауза важнее самого повтора —
// мгновенный повтор попадает в ту же нехватку ресурсов. Три срыва подряд — уже сигнал.
const runTwice = async dir => {
  for (let i = 0; i < 3; i++) {
    const r = await run(dir);
    if (!r.err) return r;
    if (i < 2) await new Promise(t => setTimeout(t, 2500));
    else return r;
  }
};

const JOBS = Math.max(1, Number(process.env.SELFTEST_JOBS) || 5);

const args = process.argv.slice(2).filter(a => a !== '--');
let cases = CASES;
if (args.length) {
  const want = new Set(args);
  cases = CASES.filter(([dir, area]) => want.has(dir) || (area !== null && want.has(area)));
  const known = new Set(cases.flatMap(([dir, area]) => area === null ? [dir] : [dir, area]));
  const unknown = args.filter(a => !known.has(a) && a !== 'motion');
  if (unknown.length) {
    console.error(`неизвестные фикстуры: ${unknown.join(', ')}`);
    if (!cases.length) { server.close(); process.exit(2); }
  }
}

// вердикт по одной фикстуре — та же логика, что была в последовательном цикле
const verdict = (dir, area, r) => {
  if (r.err) return { line: `\u2717 ${dir}: ${r.err}`, bad: true };
  const areas = [...new Set(r.fails.map(f => f.area))];
  if (area === null) {
    if (areas.length) return { line: `\u2717 ${dir}: на чистой странице сработало — ${areas.join(', ')}`, bad: true };
    return { line: `\u00b7 ${dir}: чисто, как и должно`, bad: false };
  }
  if (areas.includes(area)) {
    return { line: `\u00b7 ${dir}: «${area}» поймана${areas.length > 1 ? ` (попутно: ${areas.filter(a => a !== area).join(', ')})` : ''}`, bad: false };
  }
  return { line: `\u2717 ${dir}: проба «${area}» промолчала на своём дефекте${areas.length ? ` (сработали только: ${areas.join(', ')})` : ''}`, bad: true };
};

// пул воркеров: фикстуры независимы (qa.mjs поднимает свой браузер, общих файлов/портов нет),
// поэтому гоняем JOBS штук одновременно; результаты складываем по индексу, а не по готовности.
const results = new Array(cases.length);
const t0 = Date.now();
let done = 0;
let next = 0;
const live = !process.env.SELFTEST_QUIET;

const worker = async () => {
  for (;;) {
    const idx = next++;
    if (idx >= cases.length) return;
    const [dir, area] = cases[idx];
    const started = Date.now();
    const r = await runTwice(dir);
    results[idx] = verdict(dir, area, r);
    done++;
    if (live) process.stderr.write(`[${String(done).padStart(2)}/${cases.length}] ${results[idx].bad ? '\u2717' : '\u00b7'} ${dir} (${((Date.now() - started) / 1000).toFixed(1)}с)\n`);
  }
};

if (live) process.stderr.write(`прогон ${cases.length} фикстур, воркеров: ${Math.min(JOBS, cases.length)}\n`);
await Promise.all(Array.from({ length: Math.min(JOBS, cases.length) }, worker));
if (live) process.stderr.write(`всего ${((Date.now() - t0) / 1000).toFixed(1)}с\n`);

let bad = 0;
for (const r of results) { console.log(r.line); if (r.bad) bad++; }

// --- motion.mjs: два прогона, ожидание по метрикам
const MOTION = [
  ['m1-hero',   r => r.reducedMatch === true  && r.longFrames <= 2],
  ['m2-broken', r => r.reducedMatch === false && r.longFrames >= 10],
];
const wantMotion = !args.length || args.includes('motion');
// motion.mjs запускаем через async spawn, а не spawnSync: фикстуры m1/m2 раздаёт
// http-сервер этого же процесса (см. server выше), а spawnSync блокирует event loop
// целиком — сервер не успевает ответить на page.goto, и ребёнок падает по таймауту.
const runMotion = (bin, args) => new Promise(res => {
  const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  p.stdout.on('data', d => (stdout += d));
  p.stderr.on('data', d => (stderr += d));
  p.on('close', () => res({ stdout, stderr }));
});
if (wantMotion) {
  const M = path.join(HERE, 'motion.mjs');
  for (const [dir, ok] of MOTION) {
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'selftest-motion-'));
    const url = `http://127.0.0.1:${PORT}/${dir}/index.html`;
    const r = await runMotion(process.execPath, [M, url, outdir, '--hero', '3000', '--scroll', '2000', '--name', dir]);
    const json = path.join(outdir, `${dir}-motion-1440.json`);
    const files = ['-hero.png', '-scroll.png', '-reduced.png'].map(s => path.join(outdir, `${dir}-motion-1440${s}`));
    let line, isBad;
    if (!fs.existsSync(json)) { line = `✗ ${dir}: motion.mjs не отдал JSON: ${(r.stderr || '').trim().split('\n').slice(-2).join(' / ')}`; isBad = true; }
    else {
      const m = JSON.parse(fs.readFileSync(json, 'utf8'));
      const missing = files.filter(f => !fs.existsSync(f));
      if (missing.length) { line = `✗ ${dir}: нет файлов ${missing.map(f => path.basename(f)).join(', ')}`; isBad = true; }
      else if (!ok(m)) { line = `✗ ${dir}: метрики не те — longFrames ${m.longFrames}, reducedMatch ${m.reducedMatch} (PSNR ${m.reducedPsnr})`; isBad = true; }
      else { line = `· ${dir}: motion — longFrames ${m.longFrames}, reduced ${m.reducedMatch ? 'совпал' : 'не совпал'}, как и должно`; isBad = false; }
    }
    console.log(line); if (isBad) bad++;
  }
}

console.log('════════════════════════════════════════════════════');
console.log(bad ? `САМОПРОВЕРКА: СЛОМАНО ${bad}` : `САМОПРОВЕРКА: все ${cases.length} в порядке`);
server.close();
process.exit(bad ? 1 : 0);
