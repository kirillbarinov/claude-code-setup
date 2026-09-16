// Снимок страницы для слепого критика (§6г) и для собственных глаз (§6).
//
// Критику отдаются не только полные полотна: половина машинных дефектов живёт в состояниях,
// которых на fullPage-скриншоте нет вовсе. Кнопка без hover, поле без фокуса и форма, ни разу
// не отправленная пустой, выглядят на снимке одинаково хорошо — и одинаково мертвы в браузере.
// Поэтому набор кадров задаётся флагами, а не пишется руками во временных скриптах.
//
//   shot.mjs <URL> <файл.png> [ширина]              полотно целиком (как раньше)
//   shot.mjs <URL> <файл.png> --w 390 --fold        только первый экран
//   shot.mjs <URL> <файл.png> --hover "a.cta"       курсор наведён
//   shot.mjs <URL> <файл.png> --focus "input#mail"  фокус приведён клавиатурой (см. ниже)
//   shot.mjs <URL> <файл.png> --click "button[type=submit]"   после нажатия
//   shot.mjs <URL> <файл.png> --sel "form"          кадр одного элемента, не всей страницы
//
// Дополнительно: --h <высота вьюпорта>, --wait <мс сверх ожидания сети>, --dpr <1|2>,
// --dark (prefers-color-scheme: dark), --motion (не гасить анимации),
// --pad <px> (поля вокруг --sel; по умолчанию 8, а с --focus 16 — чтобы кольцо фокуса,
// которое рисуется снаружи бокса, попало в кадр, а не оказалось срезанным).
//
// Про `--focus`. Программный `el.focus()` в Chromium НЕ включает `:focus-visible` — то есть снимет
// ровно то состояние, которого посетитель с клавиатурой никогда не увидит, и кольцо фокуса на
// кадре не появится, даже когда оно есть. Поэтому фокус доводится настоящими нажатиями Tab
// (до 60 шагов), и только если так до элемента не дойти — ставится `el.focus()`, о чём пишется
// в stderr: значит, элемент из клавиатурного обхода выпал, и это само по себе находка.

import { createRequire } from 'node:module';
const require = createRequire('/opt/homebrew/lib/node_modules/@playwright/test/');
const { chromium } = require('playwright-core');
import { warm, cold, shootFull } from './warm.mjs';

const BOOL = ['fold', 'dark', 'motion'];
const argv = process.argv.slice(2);
const pos = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const n = a.slice(2);
    if (BOOL.includes(n)) flags[n] = true;
    else flags[n] = argv[++i] ?? null;   // значение флага съедается здесь и в pos не попадает
  } else pos.push(a);
}
const flag = n => flags[n] ?? null;

const [url, out, wPos] = pos;
if (!url || !out) {
  console.error('shot.mjs <URL> <файл.png> [ширина] [--fold] [--hover|--focus|--click|--sel <селектор>]');
  process.exit(2);
}

const width  = +(flag('w') || wPos || 1280);
const height = +(flag('h') || 900);
const fold   = !!flag('fold');
const wait   = +(flag('wait') || 300);
const dpr    = +(flag('dpr') || 1);
const hover  = flag('hover');
const focus  = flag('focus');
const click  = flag('click');
const sel    = flag('sel');

const b = await chromium.launch();
const p = await b.newPage({
  viewport: { width, height },
  deviceScaleFactor: dpr,
  colorScheme: flag('dark') ? 'dark' : 'light',
  // Кадр обязан быть воспроизводимым: без этого снимок ловит анимацию в случайной фазе,
  // и два прогона подряд дают разные картинки там, где вёрстка не менялась.
  reducedMotion: flag('motion') ? 'no-preference' : 'reduce',
});
await p.goto(url, { waitUntil: 'networkidle' });

// Прогрев отложенных картинок живёт в `warm.mjs` — общем модуле, а не здесь. Причина: правило,
// спрятанное внутри одного инструмента, теряется при первом же скрипте набора, написанном
// копированием шаблона мимо `shot.mjs`. Ровно так в кадр и уехали пустые прямоугольники вместо
// половины витрины. Одно место истины — один выученный урок.
await warm(p, { settle: wait });
const missing = await cold(p);
if (missing.length) console.error(`shot: в кадр попадут ${missing.length} незагруженных картинок ` +
                                  `(${missing.slice(0, 3).join(', ')}) — это дефект страницы, не съёмки.`);

/* Рамку кадра прокручиваем ДО наведения, а не после. Мышь живёт в координатах вьюпорта, и любая
   прокрутка после `hover()` уводит из-под курсора то, на что навели: элемент уезжает, курсор
   остаётся. Так родился целый раунд критики «реакции на наведение не различаю» — на кадре её и
   правда не было, хотя в живом браузере она есть. Кадр молчал не о дизайне, а о съёмке. */
if (sel && hover) await p.locator(sel).first().scrollIntoViewIfNeeded();

const target = hover || focus || click;
if (target) {
  const el = p.locator(target).first();
  await el.waitFor({ state: 'visible', timeout: 5000 });

  if (hover) await el.hover();

  if (focus) {
    // Настоящий обход клавиатурой — единственный способ получить `:focus-visible`.
    await p.evaluate(() => document.activeElement?.blur());
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await p.keyboard.press('Tab');
      reached = await el.evaluate(node => node === document.activeElement).catch(() => false);
    }
    if (!reached) {
      await el.evaluate(node => node.focus());
      console.error(`shot: до «${target}» не дошёл Tab за 60 шагов — фокус поставлен программно.\n` +
                    `      Кольца :focus-visible на кадре не будет, и это не дефект снимка: ` +
                    `элемент выпал из клавиатурного обхода.`);
    }
  }

  if (click) {
    await el.click();
    await p.waitForTimeout(+(flag('wait') || 500));
  }
}

if (sel) {
  // Кадр элемента снимается с полями, а не по границам бокса. Причина: кольцо `:focus-visible`,
  // тень и `outline-offset` рисуются СНАРУЖИ элемента — обрезка ровно по боксу срезает именно то,
  // ради чего кадр состояния и снимался, и отдаёт критику картинку, на которой фокуса «нет».
  const el = p.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) { console.error(`shot: «${sel}» не виден — кадр элемента снять нечем.`); process.exit(3); }
  const pad = +(flag('pad') ?? (focus ? 16 : 8));
  const vp = p.viewportSize();
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width:  Math.min(vp.width,  box.x + box.width  + pad) - Math.max(0, box.x - pad),
    height: Math.min(vp.height, box.y + box.height + pad) - Math.max(0, box.y - pad),
  };
  await p.screenshot({ path: out, clip });
} else if (fold) await p.screenshot({ path: out });
else {
  // Полотно целиком снимается высоким вьюпортом, а не `fullPage`: см. `warm.mjs` — `fullPage`
  // дорисовывает область за вьюпортом отдельным проходом и умеет отдать её без картинок.
  const missingFull = await shootFull(p, out);
  if (missingFull.length) console.error(`shot: на полотне ${missingFull.length} незагруженных картинок ` +
                                        `(${missingFull.slice(0, 3).join(', ')}).`);
}

/* Кадр состояния обязан подтвердить, что состояние на нём есть. Съёмка умеет терять его молча —
   прокруткой из-под курсора, ресайзом при `fullPage`, перерисовкой, — и тогда критику уезжает
   картинка покоя под именем «наведение». Он честно отвечает «разницы не вижу», автор идёт чинить
   вёрстку, которая не сломана. Поэтому спрашиваем браузер уже ПОСЛЕ снимка: держится ли ещё
   `:hover` / `:focus` на том элементе. Не держится — говорим вслух и выходим с ненулевым кодом,
   чтобы кадр не ушёл в отчёт как ни в чём не бывало. */
if (hover || focus) {
  const still = await p.locator(target).first()
    .evaluate((n, sel) => n.matches(sel), hover ? ':hover' : ':focus').catch(() => false);
  if (!still) {
    console.error(`shot: снимок сделан, но «${target}» уже НЕ в состоянии ` +
                  `${hover ? ':hover' : ':focus'} — на кадре состояния нет.\n` +
                  `      Это дефект съёмки, а не вёрстки: не отдавай такой кадр критику.`);
    await b.close();
    process.exit(4);
  }
}
await b.close();
