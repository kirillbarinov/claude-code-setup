#!/usr/bin/env node
// Механическая проверка страницы. Заменяет самоотчёт «я проверил» на вывод, который нельзя переспорить.
//   qa.mjs <URL> [--widths 1440,390,320] [--no-js] [--json] [--scope="#ceny"] [--design=DESIGN.md]
// Выход: 0 — провалов нет, 1 — есть. Печатает компактный отчёт; его и прикладывают к §7.
//
// Что меряется (каждый пункт — потому что он уже ломался в реальных прогонах):
//   1. Переполнение   — докскролл против вьюпорта на 11 ширинах × JS/noJS, элементы за вьюпортом и за родителем.
//   2. Контраст       — обходом ЖИВОГО DOM: каждый текстовый узел против ближайшего непрозрачного фона предка.
//                       Объявленные пары в DESIGN.md этого не заменяют: цвет, попавший на вторую поверхность, — новая пара.
//   3. Фокус          — свипом по Tab, а не програмным focus(): :focus-visible на кнопках иначе не сработает.
//   4. reduced-motion — сколько анимаций реально играет при prefers-reduced-motion: reduce.
//   5. Форма          — опись полей (label/autocomplete/inputmode) и связь ошибки с полем через aria-describedby.
//   6. Фигуры         — слова внутри круглых/фиксированных фигур: ширина Range'ом и число строк.
//                       Перенос слова в круглой печати — дефект, а не приём.
//   7. Подсказки      — «листайте вправо» на ширине, где ничего не листается.
//   8. Контролы       — поле/селект/чекбокс, оставленные браузеру: эталон снимается в невидимом
//                       iframe, живой контрол сравнивается с ним. Ноль отличий = не оформляли.
//   9. Сетка          — карточки одного ряда одной высоты, у которых нижняя строка (цена,
//                       подпись) висит на своей высоте: прижата к абзацу, а не к общей линии.
//  11. Ранг           — иерархия соседей есть на 1440 и пропадает на 390: старший упёрся
//                       в потолок раньше младшего, ранг остался только на широком экране.
//  10. Разнобой       — соседи одной роли нарисованы разным языком: у одного двойная обводка и
//                       градиент, у двух других плоская рамка. Читается как недоделка, не иерархия.
//
// Правишь любую пробу — прогони `node selftest.mjs` (или `node selftest.mjs сетка` для одной).
// Проб девять, файл один, и правка ради одной легко делает слепой другую: рядом лежат фикстуры
// с известным дефектом на каждую категорию плюс заведомо чистая страница. Проба, промолчавшая
// на своей фикстуре, сломана, даже если на живой странице отчёт выглядит убедительно.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire('/opt/homebrew/lib/node_modules/@playwright/test/');
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { try { ({ chromium } = require('playwright')); }
catch { console.error('Нет playwright. Установи: npm i -g @playwright/test'); process.exit(2); } }

const args = process.argv.slice(2);
const url = (() => {
  const raw = args.find(a => !a.startsWith('--'));
  if (!raw) return raw;
  try { const u = new URL(raw); u.pathname = u.pathname.replace(/\/{2,}/g, '/'); return u.href; }
  catch { return raw; }
})();
if (!url) { console.error('qa.mjs <URL> [--widths ...] [--no-js] [--json] [--scope="<селектор>"] [--design=DESIGN.md]'); process.exit(2); }
const optWidths = (args.find(a => a.startsWith('--widths=')) || '').split('=')[1];
const WIDTHS = optWidths ? optWidths.split(',').map(Number)
  : [1440, 1024, 900, 776, 768, 700, 600, 480, 390, 360, 320];
const SKIP_NOJS = args.includes('--no-js');
const AS_JSON = args.includes('--json');
// --scope="<селектор>" сужает ВСЕ пробы до одной секции: инструмент меряет страницу,
// а задание почти всегда — секцию. Без него поведение прежнее, байт в байт.
const SCOPE = (args.find(a => a.startsWith('--scope=')) || '').slice(8).replace(/^["']|["']$/g, '') || null;

// --design=<DESIGN.md>: блок motion: во фронтматтере — шкала длительностей и режим.
// Путь нечитаемый или без валидного блока motion: — это не «флаг не передан», а провал:
// пробы по шкале молча превращаются в no-op, неотличимый от успеха, если промолчать здесь.
const DESIGN_PATH = (args.find(a => a.startsWith('--design=')) || '').slice(9) || null;
const MOTION_SPEC = (() => {
  if (!DESIGN_PATH) return null;
  const resolved = path.resolve(process.cwd(), DESIGN_PATH);
  let src;
  try { src = fs.readFileSync(resolved, 'utf8'); }
  catch {
    console.error(`⚠ --design=${DESIGN_PATH} не прочитан, проверки по шкале пропущены`);
    process.exit(2);
  }
  const fm = src.split(/^---\s*$/m)[1] || '';
  const block = /^motion:\n((?:(?:[ \t]+.*)?\n)*)/m.exec(fm); // подряд идущие строки с отступом, пустые — тоже
  if (!block) {
    console.error(`⚠ --design=${DESIGN_PATH} не прочитан, проверки по шкале пропущены`);
    process.exit(2);
  }
  const b = block[1];
  const tok = {};
  for (const [, k, v] of b.matchAll(/^\s+(micro|enter|scene):\s*(\d+)ms/gm)) tok[k] = Number(v);
  const mode = (/^\s+mode:\s*(\S+)/m.exec(b) || [])[1] || null;
  return { mode, tokens: tok };
})();

const fails = [];
const notes = [];
const fail = (area, msg) => fails.push({ area, msg });
const note = (area, msg) => notes.push({ area, msg });

// ---------------------------------------------------------------- пробы в странице
const P_OVERFLOW = () => {
  const vw = document.documentElement.clientWidth;
  const out = { beyondViewport: [], beyondParent: [], scrollRegions: [], zero: [], faint: [] };
  const name = el => el.tagName + (el.id ? '#' + el.id : '') +
    (el.classList[0] ? '.' + el.classList[0] : '') +
    (window.__qaAddr ? window.__qaAddr(el) : '');
  const visible = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return +cs.opacity > 0.05;
  };
  // Внутри скролл-региона «вылезает за вьюпорт» — норма: регион для того и сделан,
  // и он отчитывается отдельным списком. Без этого исключения любая широкая таблица
  // даёт десятки ложных хитов вместе со всеми своими строками и ячейками.
  const inScroller = el => {
    let n = el.parentElement;
    while (n && n !== document.body) {
      const o = getComputedStyle(n);
      if (/auto|scroll/.test(o.overflowX + o.overflowY) && n.scrollWidth - n.clientWidth > 1) return true;
      n = n.parentElement;
    }
    return false;
  };
  // Приём «visually hidden»: контейнер сжат до 1×1 с overflow:hidden или срезан
  // clip-path: inset(50%) — текст остаётся скринридеру, глазу не видно ничего.
  // Содержимое внутри такого контейнера обязано выходить за его границы: это и есть
  // способ спрятать текст, а не поломка. Без исключения скрытая шапка таблицы,
  // заменённая на узкой ширине карточками, даёт по четыре ложных хита на каждой
  // ширине ниже порога — и настоящее переполнение тонет среди них.
  const inClipped = el => {
    let n = el.parentElement;
    while (n && n !== document.body) {
      const o = getComputedStyle(n);
      if ((n.clientWidth <= 1 || n.clientHeight <= 1) && o.overflow !== 'visible') return true;
      if (/^inset\(/.test(o.clipPath) && /50%/.test(o.clipPath)) return true;
      n = n.parentElement;
    }
    return false;
  };
  // Обрезанное предком за вьюпорт не выносит ничего. Ячейка с `text-overflow: ellipsis`
  // честно кладёт длинное ФИО в прямоугольник шире себя — но предок с overflow:hidden
  // срезает его по своему краю, страница не расширяется и прокрутки не появляется.
  // Глаз видит многоточие, а проба без этой проверки видит «уехало за экран» и валит
  // ровно тот приём, которым переполнение и лечат.
  const clippedByAncestor = el => {
    const r = el.getBoundingClientRect();
    let n = el.parentElement;
    while (n && n !== document.body) {
      const o = getComputedStyle(n);
      if (/hidden|clip/.test(o.overflowX)) {
        const pr = n.getBoundingClientRect();
        if (r.right > pr.right + 1 || r.left < pr.left - 1) return true;
      }
      n = n.parentElement;
    }
    return false;
  };
  document.querySelectorAll('body *').forEach(el => {
    // OPTION/OPTGROUP не имеют собственной геометрии в потоке — их прямоугольники ничего не значат.
    if (['OPTION', 'OPTGROUP', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'BR'].includes(el.tagName)) return;
    // Потроха <svg> (path, rect, circle) меряются не по правилам вёрстки: прямая линия честно
    // имеет нулевую высоту. Их прямоугольники к раскладке страницы отношения не имеют.
    if (el.ownerSVGElement) return;
    // Скрытый предок обнуляет прямоугольник потомка, но собственный display у потомка остаётся
    // прежним. Без checkVisibility каждый пункт мобильного меню под `hidden lg:flex`
    // приезжает в отчёт как «нулевой» — на React-приложении это десятки ложных хитов.
    if (el.checkVisibility && !el.checkVisibility()) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const abs = cs.position === 'absolute' || cs.position === 'fixed';
    const r = el.getBoundingClientRect();
    // за вьюпортом — но не штатные offscreen-паттерны (skip-link, visually-hidden)
    const offscreenPattern = r.right < -1000 || r.left > vw + 1000 || (r.width <= 1 && r.height <= 1);
    if (inClipped(el)) return;
    if (!offscreenPattern && !inScroller(el) && !clippedByAncestor(el) && (r.right > vw + 1 || r.left < -1)) {
      out.beyondViewport.push({ el: name(el), left: +r.left.toFixed(1), right: +r.right.toFixed(1) });
    }
    const p = el.parentElement;
    // Абсолютно спозиционированный элемент по определению живёт вне потока родителя —
    // выход за его границы не поломка (так работают skip-link, тултип, бейдж на углу).
    if (p && !abs && getComputedStyle(p).overflow === 'visible' && visible(el)) {
      const ps = getComputedStyle(p);
      // У родителя с display:contents бокса нет вовсе, а у строчного (span, a) он не
      // прямоугольник, а цепочка строк: и в том и в другом случае прямоугольник родителя
      // ничего не ограничивает, и сравнение с ним даёт хит на ровном месте.
      const parentHasBox = ps.display !== 'contents' && ps.display !== 'inline';
      // Отрицательный margin — не поломка, а приём: так подсветку строки списка или
      // полноширинную полосу выводят в паддинг секции. Ровно на эту величину элементу
      // выйти и положено; хит ставится только за то, что вылезло сверх неё.
      let slackL = Math.max(0, -parseFloat(cs.marginLeft) || 0);
      let slackR = Math.max(0, -parseFloat(cs.marginRight) || 0);
      // Повёрнутый элемент отдаёт габаритный прямоугольник больше себя самого: у квадрата
      // под -9° bbox шире на 13px, хотя нарисованная в нём круглая печать не выросла ни
      // на пиксель. Считаем прирост именно от вращения (ширина вдоль собственной оси —
      // hypot(a,b)×offsetWidth) и прощаем ровно его: масштаб, растягивающий элемент
      // по-настоящему, при этом остаётся под контролем.
      const m = cs.transform && cs.transform.startsWith('matrix')
        ? cs.transform.match(/-?[\d.e+]+/g).map(Number) : null;
      if (m && m.length >= 4 && el.offsetWidth) {
        const own = Math.hypot(m[0], m[1]) * el.offsetWidth;
        const grow = (r.width - own) / 2;
        if (grow > 0) { slackL += grow; slackR += grow; }
      }
      const pr = p.getBoundingClientRect();
      if (parentHasBox && pr.width > 0 &&
          (r.right > pr.right + slackR + 1 || r.left < pr.left - slackL - 1)) {
        out.beyondParent.push({ el: name(el), parent: name(p) });
      }
    }
    // Сам «visually hidden» контейнер формально прокручиваемый: 1px ширины при
    // полноразмерном содержимом. Прокручивать там нечего и некому — глаз его не видит.
    const selfClipped = (el.clientWidth <= 1 || el.clientHeight <= 1) && cs.overflow !== 'visible'
      || (/^inset\(/.test(cs.clipPath) && /50%/.test(cs.clipPath));
    // Прокручиваемым элемент делает overflow, а не арифметика: у обычного блока
    // (overflow:visible) scrollWidth больше clientWidth просто потому, что содержимое
    // выступает и его прекрасно видно — прокручивать там нечего. Без этой проверки
    // в список скролл-регионов попадают заголовки и строки списка, и настоящий
    // регион теряется среди них.
    const scrollable = /auto|scroll/.test(cs.overflowX + ' ' + cs.overflowY);
    if (scrollable && !selfClipped && el.scrollWidth - el.clientWidth > 1 && el.clientWidth > 0) {
      const sticky = [...el.querySelectorAll('*')].filter(x => getComputedStyle(x).position === 'sticky');
      const stickyBgOk = sticky.every(x => {
        const c = getComputedStyle(x).backgroundColor.match(/[\d.]+/g);
        return c && (c.length < 4 || +c[3] === 1);
      });
      // подсказка о прокрутке — текст рядом либо aria-label на самом регионе
      const near = (el.parentElement || el).textContent || '';
      const hint = /листай|прокрут|свайп|→|scroll|swipe/i.test(near) || !!el.getAttribute('aria-label');
      out.scrollRegions.push({
        el: name(el), sw: el.scrollWidth, cw: el.clientWidth,
        focusable: el.tabIndex >= 0, sticky: sticky.length, stickyBgOk, hint
      });
    }
    if (visible(el) && !abs && el.children.length === 0 && (el.textContent || '').trim() &&
        (r.width < 1 || r.height < 1)) out.zero.push(name(el));
    if (cs.display !== 'none' && +cs.opacity > 0 && +cs.opacity < 0.15 &&
        (el.textContent || '').trim()) out.faint.push({ el: name(el), opacity: cs.opacity });
  });
  return {
    docScroll: document.documentElement.scrollWidth, vw,
    ...out,
    beyondViewport: out.beyondViewport.slice(0, 8),
    beyondParent: out.beyondParent.slice(0, 8),
  };
};

const P_CONTRAST = () => {
  const parse = c => { const m = String(c).match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // Ищем ближайший НЕПРОЗРАЧНЫЙ фон. Градиент под текстом не отменяет проверку — он её усложняет:
  // выбрасывать такие узлы значит не проверить три четверти страницы (так и было в первой версии).
  // Поэтому из градиента вытаскиваются его цветовые стопы, и контраст считается по ХУДШЕМУ из них:
  // текст обязан читаться на всей длине градиента, а не в среднем по нему.
  // Растровая картинка (url) стопов не даёт — только такой случай уходит «сверь глазом».
  const stops = str => (String(str).match(/rgba?\([^)]+\)/gi) || [])
    .map(parse).filter(c => c && (c.length < 4 || c[3] >= 0.5)).map(c => c.slice(0, 3));
  // Картинка бывает не фоном предка, а отдельным слоем под текстом: <img> плюс
  // абсолютно спозиционированная подпись поверх — самый обычный герой. Обход вверх
  // такого слоя не видит и берёт фон боди, которого за этим текстом нет нигде.
  const media = [...document.querySelectorAll('img, video, canvas, svg')]
    .map(m => ({ m, r: m.getBoundingClientRect() }))
    .filter(x => x.r.width > 40 && x.r.height > 40);
  const bgOf = el => {
    let n = el, img = false, stopEl = null;
    const cands = [];
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const bi = cs.backgroundImage;
      if (bi && bi !== 'none') {
        if (/url\(/i.test(bi)) img = true;
        cands.push(...stops(bi));
      }
      const c = parse(cs.backgroundColor);
      if (c && (c.length < 4 || c[3] === 1)) { cands.push(c.slice(0, 3)); stopEl = n; break; }
      n = n.parentElement;
    }
    if (!img && stopEl) {
      // Считается только медиа, лежащее ВНУТРИ элемента с непрозрачным фоном: то, что
      // снаружи, этим фоном перекрыто и за текстом не видно. Плюс геометрия — центр
      // текста должен попадать внутрь картинки, иначе они просто соседи.
      const t = el.getBoundingClientRect();
      const cx = t.left + t.width / 2, cy = t.top + t.height / 2;
      img = media.some(x => x.m !== el && stopEl.contains(x.m) && !x.m.contains(el) &&
        cx >= x.r.left && cx <= x.r.right && cy >= x.r.top && cy <= x.r.bottom);
    }
    if (!cands.length) cands.push([255, 255, 255]);
    return { cands, img };
  };
  const res = { checked: 0, violations: [], overImage: 0 };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = (n.textContent || '').trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    // WCAG 1.4.3 прямо освобождает текст неактивного контрола: приглушённость и есть его
    // сигнал «сюда нельзя». Требовать 4.5:1 от отключённой кнопки значит заставить её
    // выглядеть нажимаемой — дефект вместо исправления.
    if (el.closest('[disabled], [aria-disabled="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const fg = parse(cs.color);
    if (!fg || (fg.length === 4 && fg[3] === 0)) continue;
    const { cands, img } = bgOf(el);
    if (img) res.overImage++;
    const fs = parseFloat(cs.fontSize);
    const bold = +cs.fontWeight >= 700;
    const need = (fs >= 24 || (fs >= 18.66 && bold)) ? 3 : 4.5;
    // худший стоп решает: текст должен читаться на всей длине градиента
    let cr = Infinity, bg = cands[0];
    for (const c of cands) { const r2 = ratio(fg.slice(0, 3), c); if (r2 < cr) { cr = r2; bg = c; } }
    res.checked++;
    if (cr < need - 0.005) {
      res.violations.push({
        text: t.slice(0, 34),
        el: el.tagName + (el.classList[0] ? '.' + el.classList[0] : '') + (window.__qaAddr ? window.__qaAddr(el) : ''),
        fg: cs.color, bg: `rgb(${bg.join(', ')})`, fs: +fs.toFixed(1),
        ratio: +cr.toFixed(2), need, img
      });
    }
  }
  res.violations = res.violations.slice(0, 12);
  return res;
};

const P_SHAPES = () => {
  const out = [];
  document.querySelectorAll('body *').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return;
    // borderRadius приходит либо в px, либо процентом («50%») — процент надо разворачивать,
    // иначе круглая печать не считается фигурой и проверка молчит там, где она и нужна.
    const brRaw = cs.borderTopLeftRadius || '0px';
    const cw = el.clientWidth, ch = el.clientHeight;
    if (cw < 24) return;
    const br = brRaw.includes('%') ? cw * parseFloat(brRaw) / 100 : (parseFloat(brRaw) || 0);
    const round = br >= cw / 2 - 1;
    const clipped = cs.clipPath && cs.clipPath !== 'none';
    // Квадрат с обрезкой — тоже фигура. А вот «ширина в px» фигурой не делает:
    // getComputedStyle возвращает px у любого блока, и без этой оговорки
    // проверка объявляет фигурой каждый пункт меню.
    const square = Math.abs(cw - ch) <= 1 && cs.overflow !== 'visible';
    if (!round && !clipped && !square) return;
    if (!(el.textContent || '').trim()) return;
    if (el.querySelector('p,h1,h2,h3,h4,ul,table,form')) return; // не карточка, а фигура
    const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const words = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = n.textContent;
      for (const m of t.matchAll(/\S{4,}/g)) {
        const rg = document.createRange();
        rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
        const rects = [...rg.getClientRects()];
        if (!rects.length) continue;
        words.push({ w: m[0], px: +Math.max(...rects.map(x => x.width)).toFixed(1), lines: rects.length });
      }
    }
    if (words.length) out.push({
      el: el.tagName + (el.classList[0] ? '.' + el.classList[0] : '') + (window.__qaAddr ? window.__qaAddr(el) : ''),
      round, inner: +inner.toFixed(1), words: words.slice(0, 6)
    });
  });
  return out.slice(0, 12);
};

const P_FORM = () => document.querySelectorAll('form').length === 0 ? null :
  [...document.querySelectorAll('form input, form select, form textarea')]
    .filter(el => el.type !== 'hidden')
    .map(el => {
      const lab = el.labels && el.labels.length ? true
        : !!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'));
      const d = el.getAttribute('aria-describedby') || '';
      const descs = d.split(/\s+/).filter(Boolean).map(id => {
        const t = document.getElementById(id);
        if (!t) return { id, missing: true };
        return { id, visible: !t.hidden && getComputedStyle(t).display !== 'none',
                 text: (t.textContent || '').trim().slice(0, 40) };
      });
      const grouped = !!el.closest('fieldset');
      return {
        id: el.id || el.name || el.type, type: el.type,
        label: lab, autocomplete: el.getAttribute('autocomplete') || '—',
        inputmode: el.getAttribute('inputmode') || '—',
        required: el.required, invalid: el.getAttribute('aria-invalid'), descs, grouped
      };
    });


// Проба 8: контрол, оставленный браузеру.
// Мерять «дефолтность» на глаз нельзя, а по списку свойств — нельзя надёжно:
// дефолт зависит от движка и версии. Поэтому эталон снимается тут же — в невидимом
// iframe создаётся такой же тег без единого правила, и живой контрол сравнивается с ним.
// Ноль отличий = поле вообще не оформляли; системный шрифт в поле = «форму делали не те руки».
const P_DEFAULTS = () => {
  const PROPS = ['fontFamily', 'fontSize', 'borderTopWidth', 'borderTopStyle', 'borderTopColor',
                 'backgroundColor', 'borderTopLeftRadius', 'paddingLeft', 'color', 'appearance'];
  const ctrls = [...document.querySelectorAll('input, select, textarea, button, fieldset')]
    .filter(el => el.type !== 'hidden')
    .filter(el => !el.checkVisibility || el.checkVisibility());
  const STUB = /демонстрац|демо-форма|не отправля|никуда не отправ|тестовая форма|заглушк|не работает|lorem ipsum/i;
  const stub = [];
  document.querySelectorAll('form *').forEach(el => {
    if (el.children.length) return;
    const t = (el.textContent || '').trim();
    if (t && t.length < 200 && STUB.test(t)) stub.push(t.slice(0, 90));
  });
  if (!ctrls.length) return { items: [], stub };

  // CSP страницы может запретить about:blank-фрейм; тогда проба молчит, а не роняет прогон
  try {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:absolute;left:-9999px;top:0;width:800px;height:600px;border:0';
  (window.__qaBody ? window.__qaBody() : document.body).appendChild(f);
  const d = f.contentDocument;
  d.open(); d.write('<!doctype html><html><body></body></html>'); d.close();
  const cache = {};
  const refFor = el => {
    const key = el.tagName + '|' + (el.type || '');
    if (cache[key]) return cache[key];
    let r;
    if (el.tagName === 'INPUT') { r = d.createElement('input'); if (el.type) { try { r.type = el.type; } catch {} } }
    else if (el.tagName === 'SELECT') { r = d.createElement('select'); r.appendChild(d.createElement('option')); }
    else r = d.createElement(el.tagName.toLowerCase());
    d.body.appendChild(r);
    const cs = d.defaultView.getComputedStyle(r);
    const snap = {};
    PROPS.forEach(k => snap[k] = cs[k]);
    snap.accentColor = cs.accentColor;
    cache[key] = snap;
    return snap;
  };
  const bodyFont = getComputedStyle(window.__qaBody ? window.__qaBody() : document.body).fontFamily;
  // Шрифт контрола, не совпадающий со шрифтом body, сам по себе ничего не значит: моноширинный
  // в кнопке — это выбор, если тем же моноширинным набрана часть страницы, и случайность, если
  // он не встречается больше нигде. Разница видна только по остальной странице, поэтому здесь
  // собирается набор семейств, реально используемых в тексте.
  const pageFonts = new Set([bodyFont]);
  document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd,figcaption,blockquote,code,pre,a,span,strong,em,label,small').forEach(el => {
    if (el.querySelector('*')) return;                       // только листья: у обёртки шрифт не свой
    if (el.closest('input,select,textarea,button,fieldset')) return;  // текст внутри контрола — не страница
    if (!(el.textContent || '').trim()) return;
    if (el.checkVisibility && !el.checkVisibility()) return;
    pageFonts.add(getComputedStyle(el).fontFamily);
  });
  const items = ctrls.map(el => {
    const cs = getComputedStyle(el);
    const ref = refFor(el);
    const diff = PROPS.filter(k => cs[k] !== ref[k]);
    return {
      el: el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : '') +
          (el.id ? '#' + el.id : el.name ? '[name=' + el.name + ']' : ''),
      tag: el.tagName, type: el.type || '',
      diff, untouched: diff.length === 0,
      sysFont: cs.fontFamily !== bodyFont && cs.fontFamily === ref.fontFamily,
      // Спрашивать имеет смысл только про шрифт, которого на странице больше нигде нет.
      otherFont: cs.fontFamily !== bodyFont && cs.fontFamily !== ref.fontFamily
                 && !pageFonts.has(cs.fontFamily),
      font: cs.fontFamily.slice(0, 40),
      sysWidget: cs.appearance === ref.appearance && !/none/.test(cs.appearance),
      sysAccent: cs.accentColor === ref.accentColor
    };
  });
  f.remove();
  return { items, stub };
  } catch (e) { return { items: [], stub, blocked: String(e).slice(0, 80) }; }
};

// Проба 9: сетка, которая разъехалась.
// Глазом видно сразу («съехало»), но прежние пробы этого не ловят: переполнения нет, контраст
// в порядке. Правило намеренно узкое, чтобы не шуметь на обычных списках: берутся только
// карточки, стоящие В ОДИН РЯД и вытянутые до ОДНОЙ высоты (grid stretch). Если ряд выровнен
// по низу, а последняя строка в каждой карточке (цена, подпись) висит на своей высоте —
// значит, она прижата к своему абзацу, а не к общей линии, и самый ценный элемент трижды
// оказывается в непредсказуемом месте.
const P_GRID = () => {
  // Модификатор (BEM `--`, состояния `is-`/`has-`) роль карточки не меняет: `article.service` и
  // `article.service--wide` — один ряд услуг. Сравниваем по базовым классам, иначе проба слепа
  // ровно там, где сетка чаще всего и разъезжается.
  const sig = el => {
    const base = [...el.classList].filter(c => !c.includes('--') && !/^(is|has|js)-/.test(c)).sort();
    return el.tagName + (base.length ? '.' + base.join('.') : '');
  };
  const out = [];
  const seen = new Set();
  document.querySelectorAll('*').forEach(parent => {
    const kids = [...parent.children];
    if (kids.length < 3) return;
    const groups = {};
    kids.forEach(k => (groups[sig(k)] ||= []).push(k));
    for (const [key, members] of Object.entries(groups)) {
      if (members.length < 3) continue;
      const rects = members.map(m => m.getBoundingClientRect());
      if (rects.some(r => r.height < 60 || r.width < 60)) continue;          // не карточки
      const rowTops = rects.map(r => r.top);
      if (Math.max(...rowTops) - Math.min(...rowTops) > 4) continue;         // не один ряд
      const lasts = members.map(m => {
        const c = [...m.querySelectorAll('*')].filter(e => !e.children.length && (e.textContent || '').trim());
        return c.length ? c[c.length - 1] : null;
      });
      if (lasts.some(l => !l)) continue;
      // Одна и та же роль бывает завёрнута по-разному: в одной карточке подпись начинается
      // с <strong>, в соседней — голый абзац, и «последний листовой узел» даёт разные теги.
      // Поднимаемся к общему уровню, пока роли не совпадут, но не выше самой карточки.
      const depth = (el, card) => { let d = 0; while (el !== card && el.parentElement) { el = el.parentElement; d++; } return d; };
      for (let up = 0; up < 3 && new Set(lasts.map(sig)).size !== 1; up++) {
        const ds = lasts.map((l, i) => depth(l, members[i]));
        const deepest = Math.max(...ds);
        lasts.forEach((l, i) => { if (ds[i] === deepest && l.parentElement && l !== members[i]) lasts[i] = l.parentElement; });
      }
      if (new Set(lasts.map(sig)).size !== 1) continue;                      // роли так и не сошлись
      if (lasts.some((l, i) => l === members[i])) continue;                  // поднялись до самой карточки
      // Линии считаются в координатах экрана, а не в отступах внутри карточки: глаз видит,
      // где строка стоит НА СТРАНИЦЕ. Карточка выше соседней «съедает» одинаковый внутренний
      // отступ, и подпись всё равно висит на 60px ниже — внутри карточки это выглядело ровно.
      // Смотрим обе линии: держится хоть одна — осознанное выравнивание; не держится ни одна —
      // строка привязана только к длине своего абзаца.
      const boxes = lasts.map(l => l.getBoundingClientRect());
      const tops = boxes.map(b2 => Math.round(b2.top));
      const bots = boxes.map(b2 => Math.round(b2.bottom));
      const tSpread = Math.max(...tops) - Math.min(...tops);
      const bSpread = Math.max(...bots) - Math.min(...bots);
      const spread = Math.min(tSpread, bSpread);
      const id = key + '|' + members.length;
      if (seen.has(id)) continue;
      seen.add(id);
      if (spread > 8) out.push({
        group: key.slice(0, 50), n: members.length,
        row: sig(lasts[0]).slice(0, 40),
        text: (lasts[0].textContent || '').trim().slice(0, 30),
        gaps: (tSpread <= bSpread ? tops : bots).map(v => v - Math.min(...(tSpread <= bSpread ? tops : bots))),
        edge: tSpread <= bSpread ? 'верх' : 'низ',
        spread
      });
    }
  });
  return out;
};


// Проба 10: соседи одной роли оформлены разным визуальным языком.
// Иерархию задают размером, весом, цветом — это замысел. Но когда в ряду из трёх одинаковых
// по роли элементов у одного двойная обводка и градиент, а у двух других плоская серая рамка,
// глаз читает не иерархию, а недоделку: будто на первом застряло состояние наведения.
// Сравниваются не цвета и размеры (они и должны различаться), а язык оформления: есть ли
// обводка и какого она типа, скруглён ли элемент.
const P_STYLE = () => {
  const sig = el => {
    const base = [...el.classList].filter(c => !c.includes('--') && !/^(is|has|js)-/.test(c)).sort();
    return el.tagName + (base.length ? '.' + base.join('.') : '');
  };
  // Состояние — законная причина выглядеть иначе: текущий пункт меню, раскрытый аккордеон,
  // выбранная вкладка. Такой элемент из сравнения выпадает, иначе проба ругается на работающий UI.
  const stateful = el => el.matches('[aria-current]:not([aria-current="false"]), [aria-selected="true"], [aria-expanded="true"], [open], .is-active, .active, .selected, :checked')
    || !!el.closest('[aria-current]:not([aria-current="false"]), [aria-selected="true"], [open], .is-active, .active, .selected');
  // Сравниваются только те свойства, которые почти никогда не различают осознанно.
  // Наличие градиента и тени сюда не входит: ими штатно выделяют золотую медаль, выбранную
  // ячейку, тариф «популярный» — ряд с одним подсвеченным элементом это замысел, а не разнобой.
  // Наличие/отсутствие рамки — тоже: так рисуют разделители, где у последнего в ряду линии нет.
  // Остаётся тип обводки (плоская против двойной или пунктирной) и скругление: их разность
  // у соседей одной роли осмысленного объяснения обычно не имеет.
  const lang = el => {
    const c = getComputedStyle(el);
    const styles = ['Top', 'Right', 'Bottom', 'Left']
      .filter(x => (parseFloat(c['border' + x + 'Width']) || 0) > 0)
      .map(x => c['border' + x + 'Style']);
    return [
      // null = «не сравнивать»: рамки нет вовсе, различие свелось бы к разделителю
      styles.length ? 'обводка:' + [...new Set(styles)].sort().join('/') : null,
      'скругление:' + (parseFloat(c.borderTopLeftRadius) >= 4 ? 'да' : 'нет')
    ];
  };
  const out = [];
  const seen = new Set();
  document.querySelectorAll('*').forEach(parent => {
    const kids = [...parent.children];
    if (kids.length < 3) return;
    const groups = {};
    kids.forEach(k => (groups[sig(k)] ||= []).push(k));
    for (const [key, members] of Object.entries(groups)) {
      if (members.length < 3) continue;
      if (members.some(stateful)) continue;
      // Сравниваются и сами соседи, и их одноимённые потомки: модификатор чаще висит на
      // карточке, а разным языком нарисована фигура внутри неё.
      const maps = members.map(m => {
        const map = new Map([['', m]]);
        m.querySelectorAll('*').forEach(e => { const k2 = sig(e); if (!map.has(k2)) map.set(k2, e); });
        return map;
      });
      const shared = [...maps[0].keys()].filter(k2 => maps.every(mm => mm.has(k2)));
      for (const part of shared) {
        const els = maps.map(mm => mm.get(part));
        if (els.some(stateful)) continue;
        const rects = els.map(e => e.getBoundingClientRect());
        if (rects.some(r => r.width * r.height < 400)) continue;              // мелочь вроде иконки-точки
        const langs = els.map(lang);
        for (let i = 0; i < langs[0].length; i++) {
          const vals = langs.map(l => l[i]);
          if (vals.some(v => v === null)) continue;
          const uniq = [...new Set(vals)];
          if (uniq.length < 2) continue;
          // Один против остальных — это разнобой. Половина на половину бывает осознанным
          // делением ряда (две группы), такое не трогаем.
          const counts = uniq.map(u => vals.filter(v => v === u).length);
          const odd = counts.filter(c2 => c2 === 1).length;
          if (odd !== 1 || uniq.length !== 2) continue;
          const id = key + '|' + part + '|' + i;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({
            group: key.slice(0, 40),
            part: part ? part.slice(0, 40) : '(сам элемент)',
            n: members.length,
            what: vals.join('  vs  ').slice(0, 90)
          });
        }
      }
    }
  });
  return out;
};

// Проба 11: иерархия, которая держится только на широком экране.
// Старшая печать 208px против младших 148 — отношение 1.4, ранг виден сразу. На 390px те же
// печати становятся 152 и 128: отношение 1.19, круги читаются как одинаковые, а разный кегль
// внутри — уже не как ранг, а как рассинхрон. Схлопывание почти всегда невольное: размеры
// заданы clamp'ами и медиазапросами порознь, и на узкой ширине старший упирается в потолок
// раньше младшего. Меряются только те величины, которые схлопываться не обязаны: кегль текста
// и диаметр квадратных фигур. Ширина карточки в счёт не идёт — она законно равняется, когда
// сетка складывается в одну колонку.
const P_RANK = () => {
  const sig = el => {
    const base = [...el.classList].filter(c => !c.includes('--') && !/^(is|has|js)-/.test(c)).sort();
    return el.tagName + (base.length ? '.' + base.join('.') : '');
  };
  const out = {};
  document.querySelectorAll('*').forEach(parent => {
    const kids = [...parent.children];
    if (kids.length < 2) return;
    const groups = {};
    kids.forEach(k => (groups[sig(k)] ||= []).push(k));
    for (const [key, members] of Object.entries(groups)) {
      if (members.length < 2) continue;
      const maps = members.map(m => {
        const map = new Map([['', m]]);
        m.querySelectorAll('*').forEach(e => { const k2 = sig(e); if (!map.has(k2)) map.set(k2, e); });
        return map;
      });
      const shared = [...maps[0].keys()].filter(k2 => maps.every(mm => mm.has(k2)));
      for (const part of shared) {
        const els = maps.map(mm => mm.get(part));
        const rects = els.map(e => e.getBoundingClientRect());
        if (rects.some(r => r.width * r.height < 100)) continue;
        const id = sig(parent) + '>' + key + '|' + (part || '(сам)');
        // кегль: только у элементов с собственным текстом
        const own = els.map(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
        if (own.every(Boolean)) out[id + '|кегль'] = els.map(e => parseFloat(getComputedStyle(e).fontSize));
        // диаметр: только у квадратных фигур, где ширина и высота заданы заодно
        if (rects.every(r => Math.abs(r.width - r.height) <= 2)) out[id + '|диаметр'] = rects.map(r => Math.round(r.width));
      }
    }
  });
  return out;
};

// Проба 12: край контрола нарисован, но не опознаётся.
// WCAG 1.4.11 требует от нетекстового элемента 3:1 — иначе поле не отделено от фона.
// Хуже полного отсутствия рамки — «призрачный контур»: линия нарисована, но такая
// бледная, что глаз видит прямоугольник и не может опереться на его край. Это не
// экономия и не минимализм, это неоплаченный чек: автору кажется, что рамка есть.
const P_EDGE = () => {
  const parse = c => { const m = String(c).match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const opaque = c => c && (c.length < 4 || c[3] >= 0.95) ? c.slice(0, 3) : null;
  const around = el => {
    let n = el.parentElement;
    while (n) {
      const c = opaque(parse(getComputedStyle(n).backgroundColor));
      if (c) return c;
      n = n.parentElement;
    }
    return [255, 255, 255];
  };
  const out = [];
  document.querySelectorAll('input, select, textarea, button').forEach(el => {
    if (el.type === 'hidden') return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.3) return;
    // WCAG 1.4.11 выводит неактивные компоненты из-под требования 3:1, и по делу:
    // приглушённый край отключённой кнопки — её единственный способ сказать «сюда нельзя».
    // Дотянуть его до 3:1 значит вернуть кнопке вид нажимаемой.
    if (el.closest('[disabled], [aria-disabled=\"true\"]')) return;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    // Тень — тоже способ отделить контрол, но её силу так не измеришь: цвет, размытие
    // и смещение дают край, которого нет ни в одном свойстве по отдельности. Такой
    // контрол пропускается целиком: лучше промолчать, чем обвинить оформленное поле.
    if (cs.boxShadow && cs.boxShadow !== 'none') return;
    const bgA = around(el);
    let bgS = opaque(parse(cs.backgroundColor));
    // Заливка бывает градиентом, и тогда backgroundColor прозрачен. Берётся худший стоп:
    // край обязан быть виден по всей длине кнопки, а не в среднем по ней.
    if (!bgS && cs.backgroundImage && cs.backgroundImage !== 'none' && !/url\(/i.test(cs.backgroundImage)) {
      const st = (cs.backgroundImage.match(/rgba?\([^)]+\)/gi) || []).map(parse).map(opaque).filter(Boolean);
      if (st.length) st.sort((a, b) => ratio(a, bgA) - ratio(b, bgA)), bgS = st[0];
    }
    const signals = [];
    // Заливка засчитывается сигналом, только если она вообще отличима от фона. Ячейка
    // решётки, которой край рисуют соседи и внешняя рамка, красится в цвет поверхности:
    // формально background есть, глазу он не даёт ничего. Считать такую заливку сигналом
    // и тут же валить её как «край 1:1» — обвинять элемент в том, что у него нет края,
    // хотя край ему и не положен. Отсутствие собственного края ловит проба 8.
    if (bgS && ratio(bgS, bgA) >= 1.05) signals.push({ what: 'заливка', cr: ratio(bgS, bgA) });
    const sides = [['верх', 'Top'], ['право', 'Right'], ['низ', 'Bottom'], ['лево', 'Left']];
    const drawn = [];
    for (const [ru, S] of sides) {
      const w = parseFloat(cs['border' + S + 'Width']);
      const st = cs['border' + S + 'Style'];
      if (!(w >= 1) || st === 'none' || st === 'hidden') continue;
      const c = parse(cs['border' + S + 'Color']);
      if (!c || (c.length === 4 && c[3] < 0.3)) continue;  // прозрачная рамка нарисована не для глаза
      // Линия граничит с двумя фонами сразу; видно её, если она различима хоть с одной стороны.
      const cr = Math.max(ratio(c.slice(0, 3), bgA), bgS ? ratio(c.slice(0, 3), bgS) : 0);
      drawn.push({ side: ru, w, cr, color: cs['border' + S + 'Color'] });
      signals.push({ what: 'рамка ' + ru, cr });
    }
    // Ни заливки, ни рамки — это не слабый край, а отсутствие CSS-края вовсе: либо нативный
    // виджет, край которому рисует браузер (радиокнопка, чекбокс), либо поле внутри обёртки,
    // которая и есть видимая рамка. Ни то ни другое здесь не измеряется, а «не оформлен вовсе»
    // ловит проба 8 — своим способом и без догадок про то, кто рисует край.
    if (!signals.length) return;
    const best = Math.max(...signals.map(s => s.cr));
    const ghosts = drawn.filter(d => d.cr < 2.995);
    const id = el.tagName + (el.type ? '[' + el.type + ']' : '') + (el.id ? '#' + el.id : el.name ? '#' + el.name : '');
    if (best < 2.995) out.push({ el: id, kind: 'слабо', best: +best.toFixed(2), ghosts: [] });
    else if (ghosts.length) out.push({ el: id, kind: 'призрак', best: +best.toFixed(2),
      ghosts: ghosts.map(g => `${g.side} ${g.w}px ${g.color} = ${g.cr.toFixed(2)}:1`) });
  });
  return out.slice(0, 8);
};

// Проба 13: зазор внутри повторяющегося блока гуляет от соседа к соседу.
// Три медальона одной роли: круг и подпись под ним. Круги разного калибра по замыслу,
// подписи subgrid держит на одной линии — и от этого расстояние от круга до его подписи
// вышло 16px у крупного и 76px у мелких. Пара «фигура + её подпись» связана смыслом,
// а не координатами: когда одна и та же по смыслу связь нарисована втрое слабее у соседа,
// меньший элемент читается не как меньший, а как провалившийся в дыру под собой.
// Меряется только вертикальный зазор между соседями, реально стоящими друг под другом.
const P_GAP = () => {
  const sig = el => {
    const base = [...el.classList].filter(c => !c.includes('--') && !/^(is|has|js)-/.test(c)).sort();
    return el.tagName + (base.length ? '.' + base.join('.') : '');
  };
  const vis = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'absolute' || cs.position === 'fixed') return false;
    const r = el.getBoundingClientRect();
    return r.width >= 8 && r.height >= 8;
  };
  const out = [];
  document.querySelectorAll('*').forEach(parent => {
    const kids = [...parent.children].filter(vis);
    if (kids.length < 2) return;
    const groups = {};
    kids.forEach(k => (groups[sig(k)] ||= []).push(k));
    for (const [key, members] of Object.entries(groups)) {
      if (members.length < 2) continue;
      // пара соседей внутри блока опознаётся и по подписи обоих, и по месту в порядке:
      // одинаковые подписи у разных пар одного блока встречаются, и путать их нельзя.
      const pairsOf = m => {
        const ch = [...m.children].filter(vis);
        const res = [];
        for (let i = 0; i + 1 < ch.length; i++) {
          const a = ch[i].getBoundingClientRect(), b = ch[i + 1].getBoundingClientRect();
          // только колонка: следующий начинается ниже конца предыдущего и они пересекаются по X
          if (b.top < a.bottom - 1) continue;
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) < 4) continue;
          res.push([i + '|' + sig(ch[i]) + '\u2192' + sig(ch[i + 1]), b.top - a.bottom]);
        }
        return new Map(res);
      };
      const maps = members.map(pairsOf);
      if (!maps[0] || !maps[0].size) continue;
      const shared = [...maps[0].keys()].filter(k2 => maps.every(mm => mm.has(k2)));
      for (const pk of shared) {
        const gaps = maps.map(mm => mm.get(pk));
        const mn = Math.min(...gaps), mx = Math.max(...gaps);
        if (mn < 0) continue;
        // 12px — ниже этого разница не читается как разный ритм; вдвое — уже другая связь,
        // а не погрешность округления строки: 16 против 76 у медальонов давало 4.75x.
        if (mx - mn >= 12 && mx >= 2 * Math.max(mn, 1)) {
          out.push({ группа: sig(parent) + '>' + key, пара: pk.slice(pk.indexOf('|') + 1),
            зазоры: gaps.map(g => Math.round(g)) });
        }
      }
    }
  });
  return out.slice(0, 6);
};

// Проба 14: выделенный зачин есть у части элементов одной роли.
// Три медальона гарантий: у первого подпись начиналась «<strong>Гарантия на переплёт.</strong>
// Разошёлся блок…», у двух соседних такого зачина не было. Крупный круг — заявленная
// иерархия, и она честная; но зачин внутри текста — второй, независимый уровень, и он
// оказался ровно у одного из трёх. Глаз читает это не как «этот важнее», а как работу,
// брошенную на середине: начали унифицировать подписи и не довели. Ловится узкий случай —
// первый видимый узел одноимённого потомка либо акцентный, либо нет, и внутри группы
// это расходится.
const P_MINOR = () => {
  // Заголовок, который раскрывает свой блок (summary аккордеона, строка-раскрывашка,
  // кнопка с aria-expanded), — это контент уровня раздела, а не подпись. Если он набран
  // не крупнее обычного абзаца, ряд таких строк читается как список микроподписей: глаз
  // не находит ни одной точки входа и проскальзывает секцию целиком. Меряем кегль такой
  // строки против кегля основного текста страницы — медианы по абзацам, а не против body,
  // потому что body часто задан «на вырост» и абзацы его переопределяют.
  const px = v => parseFloat(v) || 0;
  const vis = el => { const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const paras = [...document.querySelectorAll('p, li')].filter(el =>
    vis(el) && (el.textContent || '').trim().length > 60).map(el => px(getComputedStyle(el).fontSize)).sort((a, b) => a - b);
  if (paras.length < 2) return [];
  const base = paras[Math.floor(paras.length / 2)];
  const heads = [...document.querySelectorAll('summary, [aria-expanded]')].filter(el => {
    if (!vis(el)) return false;
    const t = (el.textContent || '').trim();
    return t.length > 8 && t.length < 200;   // не иконка-кнопка и не целый абзац внутри
  });
  // Кегль заголовка — это кегль его самой крупной строки, а не computed font-size
  // контейнера: строку-раскрывашку часто собирают из служебных мелких кусков (шифр,
  // формат, хронометраж) и одного имени, набранного крупно. Меряя контейнер, проба
  // ставит хит ровно там, где точка входа для глаза как раз есть.
  const headSize = el => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let max = 0;
    for (let n; (n = w.nextNode());) {
      if (!(n.nodeValue || '').trim()) continue;
      const par = n.parentElement;
      if (!par || !vis(par)) continue;
      max = Math.max(max, px(getComputedStyle(par).fontSize));
    }
    return max || px(getComputedStyle(el).fontSize);
  };
  const small = heads.map(el => ({ el, fs: headSize(el) })).filter(h => h.fs <= base);
  if (small.length < 2) return [];
  const worst = small.reduce((a, b) => (b.fs < a.fs ? b : a));
  return [{ n: small.length, всего: heads.length, кегль: Math.round(worst.fs * 10) / 10, текст: Math.round(base * 10) / 10,
            что: (worst.el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48) }];
};

const P_LOREM = () => {
  // Рыба, оставшаяся в готовой странице. Дефолтный номер «000-00-00», почта на example.com
  // или .invalid, «Lorem ipsum», «Название компании» — всё это стоит ровно в тех местах,
  // где посетитель проверяет, живые ли за страницей люди: контакты, подпись, реквизиты.
  // Одна такая строка обнуляет доверие, набранное фотографией и ценами выше: страница
  // перестаёт быть мастерской и становится демо-шаблоном, который забыли заполнить.
  const marks = [
    [/lorem\s+ipsum|dolor\s+sit\s+amet|consectetur\s+adipisc/i, 'латинская рыба'],
    [/@example\.(com|org|net|invalid|test)|@(test|invalid|localhost)\b/i, 'почта на служебном домене'],
    [/(?:^|\D)(?:\+7\s*)?\(?0{3}\)?[\s-]*0{3}[\s-]*0{2}[\s-]*0{2}(?:\D|$)/, 'телефон из нулей'],
    [/\+1\s*234\s*567|123[\s-]45[\s-]67|555[\s-]?01\d\d/, 'демонстрационный номер'],
    [/название\s+компании|ваш\s+текст\s+здесь|текст\s+заголовка|your\s+(company|text|name\s+here)|company\s+name\b/i, 'незаполненная заглушка'],
    [/\bjohn\s+doe\b|\bиван\s+иванов\b|\bпример@|\bmail@mail\b/i, 'имя-заглушка'],
    [/https?:\/\/(www\.)?example\.(com|org|net)/i, 'ссылка на example.com'],
    // Честная разметка недостающих данных из §1а брифа: `[ЦЕНА — уточнить]`. Она заводится
    // намеренно и правильно — выдумать цену хуже, чем оставить дыру видимой, — но живёт только
    // до сдачи. Место незакрытому вопросу в отчёте (§7), а не в странице, которую покажут
    // заказчику как есть; проба знает ровно тот формат, который предписывает бриф.
    [/\[[^\]\n]{0,60}уточнить\]|\[[^\]\n]{0,60}—\s*(нет данных|спросить)\]/i, 'незакрытый вопрос к заказчику из брифа'],
  ];
  const hits = [];
  const seen = new Set();
  const push = (kind, text, where) => {
    const key = kind + '|' + text;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ род: kind, что: text.replace(/\s+/g, ' ').trim().slice(0, 60), где: where });
  };
  const vis = el => { const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const area = el => {
    for (let n = el; n; n = n.parentElement) {
      const t = n.tagName ? n.tagName.toLowerCase() : '';
      if (t === 'footer') return 'подвал';
      if (t === 'header') return 'шапка';
      if (t === 'form') return 'форма';
      if (t === 'section' && n.id) return 'секция #' + n.id;
    }
    return 'страница';
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || /script|style|noscript/i.test(el.tagName) || !vis(el)) continue;
    const t = n.nodeValue || '';
    if (t.trim().length < 3) continue;
    for (const [re, kind] of marks) { const m = t.match(re); if (m) push(kind, m[0], area(el)); }
  }
  for (const a of document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], a[href^="http"]')) {
    if (!vis(a)) continue;
    for (const [re, kind] of marks) { const m = (a.getAttribute('href') || '').match(re); if (m) push(kind, m[0], area(a)); }
  }
  return hits;
};

// 20. Служебная шапка съедает первый экран на узкой ширине.
// Меню — вход в содержание, а не содержание: если четверть первого экрана уходит на
// навигацию до того, как показан заголовок, посетитель за свои две секунды видит
// оглавление чужого сайта вместо предложения. На широкой ширине то же меню стоит
// в строку и ничего не стоит — дефект живёт только на узкой.
const P_FOLD = () => {
  // Внутри закрытого <details> Chrome держит content-visibility: hidden: размеры из
  // прошлой раскладки сохраняются, и getBoundingClientRect честно отдаёт 138px у меню,
  // которого на экране нет. Отсюда checkVisibility — на глаз такую полосу не поймать.
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  };
  const h1 = [...document.querySelectorAll('h1')].find(vis);
  if (!h1) return [];
  const top = h1.getBoundingClientRect().top + window.scrollY;
  const chrome = [...document.querySelectorAll('header, nav, [role="banner"], [role="navigation"]')]
    .filter(vis)
    .map((el) => { const r = el.getBoundingClientRect(); return [r.top + window.scrollY, r.bottom + window.scrollY]; })
    .filter(([a, b]) => b <= top + 1 && b > a)
    .sort((x, y) => x[0] - y[0]);
  if (!chrome.length) return [];
  // склеиваем вложенные и перекрывающиеся полосы, иначе nav внутри header посчитается дважды
  const merged = [];
  for (const [a, b] of chrome) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const eaten = merged.reduce((s, [a, b]) => s + (b - a), 0);
  const share = eaten / window.innerHeight;
  if (share <= 0.25) return [];
  return [{
    высота: Math.round(eaten),
    доля: Math.round(share * 100),
    верхH1: Math.round(top),
    экран: window.innerHeight,
    что: (h1.innerText || '').trim().slice(0, 40),
  }];
};

const P_GHOST = () => {
  // Заливка, которая отличается от подложки меньше чем на 1.2:1, не читается как плоскость.
  // Она включается площадью: у поля 524x44 её не видно совсем, у textarea 1072x98 те же
  // 1.15:1 набирают впятеро больше пикселей и уже читаются как залитый бокс — один CSS даёт
  // в одной форме два типа поля. Ловим ряд однотипных полей, у которых заливка ниже порога,
  // и площади различаются больше чем втрое: именно тогда разночтение видно глазом.
  const MIN_RATIO = 1.2;
  const AREA_SPREAD = 3;
  const lum = c => {
    const m = (c || '').match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    const [r, g, b] = m.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, z) => { const l1 = lum(a), l2 = lum(z); if (l1 === null || l2 === null) return null;
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const behind = el => { let n = el.parentElement;
    while (n) { const c = getComputedStyle(n).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)') return c; n = n.parentElement; }
    return 'rgb(255, 255, 255)'; };
  const fields = [...document.querySelectorAll('input, textarea, select')].filter(el => {
    const t = (el.type || '').toLowerCase();
    if (t === 'checkbox' || t === 'radio' || t === 'hidden' || t === 'submit' || t === 'button') return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  });
  const ghosts = fields.map(el => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const fill = cs.backgroundColor;
    if (!fill || fill === 'rgba(0, 0, 0, 0)') return null;   // заливки нет вовсе — вопроса нет
    const k = ratio(fill, behind(el));
    if (k === null || k >= MIN_RATIO) return null;
    return { что: el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : ''), k: Math.round(k * 100) / 100,
             площадь: Math.round(r.width * r.height) };
  }).filter(Boolean);
  if (ghosts.length < 2) return [];
  const areas = ghosts.map(g => g.площадь);
  const spread = Math.max(...areas) / Math.max(1, Math.min(...areas));
  if (spread < AREA_SPREAD) return [];
  const big = ghosts.find(g => g.площадь === Math.max(...areas));
  const small = ghosts.find(g => g.площадь === Math.min(...areas));
  return [{ n: ghosts.length, k: big.k, большой: big.что, sBig: big.площадь, малый: small.что, sSmall: small.площадь,
            разброс: Math.round(spread * 10) / 10 }];
};

const P_RULE = () => {
  // Черта отбивает то, вдоль чего идёт целиком. Если вдоль неё есть длинный
  // отрезок без содержимого, она отбивает и его — обводит пустоту.
  const MIN_LINE = 120;   // короче — уже не «черта вдоль колонки», а деталь
  const MIN_VOID = 96;    // пустой отрезок короче — воздух, а не провал
  const out = [];
  const seen = new Set();
  document.querySelectorAll('*').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    // фон или тень делают из элемента карточку: там линия — край карточки, а не отбивка
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.boxShadow !== 'none') return;
    const w = ['Top','Right','Bottom','Left'].map(s => parseFloat(cs['border' + s + 'Width']) || 0);
    const n = w.filter(v => v > 0).length;
    if (n !== 1) return;                       // рамка по периметру — не отбивка
    const side = ['top','right','bottom','left'][w.findIndex(v => v > 0)];
    // Только вертикальная черта. У горизонтальной пустота вдоль неё — это просто
    // строка короче колонки («от 4 200 ₽» под чертой во всю ширину), и она читается
    // нормально: черта задаёт ширину, текст под ней её не обязан заполнять. Обводкой
    // пустоты выглядит именно вертикальная линия, идущая вдоль высоты без содержимого.
    const vert = side === 'left' || side === 'right';
    if (!vert) return;
    const r = el.getBoundingClientRect();
    const len = vert ? r.height : r.width;
    if (len < MIN_LINE) return;
    // где вдоль черты действительно есть содержимое
    const boxes = [];
    el.querySelectorAll('*').forEach(k => {
      if (!k.children.length || k.childNodes.length !== k.children.length) {
        const kr = k.getBoundingClientRect();
        if (kr.width > 0 && kr.height > 0) boxes.push(kr);
      }
    });
    if (!boxes.length) return;
    const a = vert ? Math.min(...boxes.map(b => b.top)) : Math.min(...boxes.map(b => b.left));
    const z = vert ? Math.max(...boxes.map(b => b.bottom)) : Math.max(...boxes.map(b => b.right));
    const before = (vert ? a - r.top : a - r.left);
    const after = (vert ? r.bottom - z : r.right - z);
    const hole = Math.max(before, after);
    if (hole < MIN_VOID) return;
    const key = el.tagName + (el.className || '') + Math.round(len);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      что: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''),
      текст: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30),
      сторона: side, длина: Math.round(len), пусто: Math.round(hole),
      где: before > after ? 'до содержимого' : 'после содержимого',
    });
  });
  return out.slice(0, 6);
};

const P_TAP = () => {
  // 44 — рекомендуемый минимум, но разница между 42 и 44 пальцем не ощущается,
  // а разница между 44 и 30 стоит промаха по соседнему пункту. Поэтому два порога:
  // ниже TIGHT — провал, между TIGHT и MIN — повод объяснить, а не дефект.
  const MIN = 44, TIGHT = 34;
  // label[for] в список мишеней не входит: подпись «Имя» действительно фокусирует
  // поле по клику, но требовать от неё роста до 44px — значит раздувать текст
  // формы ради несуществующей проблемы. Лейбл учитывается только там, где он и
  // есть настоящая мишень — вокруг флажка или переключателя.
  const SEL = 'a[href], button, [role="button"], [role="link"], [role="tab"], summary, input:not([type="hidden"]), select, textarea';
  const vis = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    if (el.disabled) return false;
    let n = el;
    while (n && n !== document.body) {
      const o = getComputedStyle(n);
      if ((n.clientWidth <= 1 || n.clientHeight <= 1) && o.overflow !== 'visible') return false;
      if (/^inset\(/.test(o.clipPath) && /50%/.test(o.clipPath)) return false;
      n = n.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Ссылка в потоке текста мишенью не считается: она часть строки, растянуть её
  // до 44px нельзя, не разорвав абзац. Признак — у родителя есть собственный текст
  // помимо этой ссылки.
  const inline = el => {
    if (el.tagName !== 'A') return false;
    const p = el.parentElement;
    if (!p) return false;
    const own = [...p.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    return own.length > 0;
  };
  // Мишень флажка — вместе с его подписью: кликается лейбл, а не только квадратик.
  const box = el => {
    let r = el.getBoundingClientRect();
    if (/^(checkbox|radio)$/.test(el.type)) {
      const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      if (lab) {
        const lr = lab.getBoundingClientRect();
        if (lr.width > 0 && lr.height > 0) r = lr;
      }
    }
    return r;
  };
  const out = [];
  document.querySelectorAll(SEL).forEach(el => {
    if (!vis(el) || inline(el)) return;
    if (el.tagName === 'LABEL' && el.querySelector('input, select, textarea')) return;
    const r = box(el);
    const w = Math.round(r.width), h = Math.round(r.height);
    const side = Math.min(w, h);
    if (side >= MIN) return;
    const t = (el.textContent || el.value || el.getAttribute('aria-label') || el.type || '').trim().slice(0, 28);
    out.push({ что: el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : ''), текст: t, w, h, тесно: side < TIGHT });
  });
  return out.slice(0, 8);
};

const P_LEAD = () => {
  const ACC = /^(STRONG|B|EM|MARK)$/;
  const sig = el => {
    const base = [...el.classList].filter(c => !c.includes('--') && !/^(is|has|js)-/.test(c)).sort();
    return el.tagName + (base.length ? '.' + base.join('.') : '');
  };
  const vis = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width >= 8 && r.height >= 8;
  };
  // зачин — акцент в самом начале текста, а не выделенное слово посреди фразы
  const lead = el => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { if (n.textContent.trim()) return null; continue; }
      if (n.nodeType !== 1) continue;
      if (!ACC.test(n.tagName)) return null;
      const t = n.textContent.trim();
      // Зачин — не любой акцент в начале, а вводная фраза: «Гарантия на переплёт.»
      // Выделенное первым число («<b>6</b> недель», «<b>4 900 ₽</b> вместо…») зачином
      // не является: это акцент внутри фразы, которому просто досталось первое место,
      // и требовать того же у соседей бессмысленно. Отсекаем по двум признакам разом —
      // законченность (точка, двоеточие, тире в конце) и минимум два слова.
      if (!t || t.length > 60) return null;
      if (!/[.:!?—]$/.test(t)) return null;
      if (t.split(/\s+/).length < 2) return null;
      return t;
    }
    return null;
  };
  const out = [];
  document.querySelectorAll('*').forEach(parent => {
    const kids = [...parent.children].filter(vis);
    if (kids.length < 2) return;
    const groups = {};
    kids.forEach(k => (groups[sig(k)] ||= []).push(k));
    for (const [key, members] of Object.entries(groups)) {
      if (members.length < 2) continue;
      // Собираем не в разреженный массив, а в список присутствующих: элемент, у
      // которого на этой позиции стоит потомок другой сигнатуры (карточка «Выбран»
      // с классом .win среди «Отвергнут»), в сравнении просто не участвует — иначе
      // дырка в массиве читалась бы как «зачина нет» и давала ложное 4 из 5.
      const byPos = {};
      members.forEach(m => {
        [...m.children].filter(vis).forEach((ch, ci) => {
          const k2 = ci + '|' + sig(ch);
          (byPos[k2] ||= []).push(lead(ch));
        });
      });
      for (const [k2, vals] of Object.entries(byPos)) {
        if (vals.length !== members.length) continue;
        const withLead = vals.filter(v => v);
        if (!withLead.length || withLead.length === vals.length) continue;
        out.push({ группа: sig(parent) + '>' + key, часть: k2.slice(k2.indexOf('|') + 1),
          есть: withLead.length, из: vals.length, пример: withLead[0].slice(0, 40) });
      }
    }
  });
  return out.slice(0, 6);
};

// ---------------------------------------------------------------- прогон
// Проба 7: подсказка утверждает состояние, которого нет.
// qa.mjs проверяет, не сломана ли страница; здесь — не врёт ли она.
// Статичная подсказка «листайте вправо» на ширине, где ничего не листается,
// проходит все механические проверки и при этом обманывает посетителя.
const P_CLAIM = () => {
  const RE = /листайте|пролистайте|прокрут|скролл|swipe|scroll (right|horizontally)|шире экрана|вправо\s*[\u2192>]|[\u2192>]\s*вправо/i;
  const scrollable = el => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflow);
  };
  const out = [];
  document.querySelectorAll('body *').forEach(el => {
    if (el.children.length) return;                       // только листовой узел с текстом
    if (el.checkVisibility && !el.checkVisibility()) return;
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length > 120 || !RE.test(txt)) return;
    // Кандидаты в «то, что должно листаться»: соседи подсказки и их потомки,
    // плюс прокручиваемые предки. Ближе искать негде — подсказку ставят рядом с блоком.
    const zone = [];
    let p = el.parentElement, hops = 0;
    while (p && hops++ < 3) { zone.push(p, ...p.querySelectorAll('*')); p = p.parentElement; }
    const boxes = [...new Set(zone)].filter(scrollable);
    if (!boxes.length) return out.push({ text: txt.slice(0, 60), verdict: 'рядом нет ни одного прокручиваемого блока' });
    const any = boxes.some(b => b.scrollWidth > b.clientWidth + 1);
    if (!any) {
      const b = boxes[0];
      out.push({ text: txt.slice(0, 60),
                 verdict: 'блок не прокручивается: scrollWidth ' + b.scrollWidth + ' / clientWidth ' + b.clientWidth });
    }
  });
  return out;
};

// Проба 7 сэмплирует 11 ширин, и ошибка на единицу в медиазапросе («подсказка гаснет на 690,
// а листаться перестаёт на 700») живёт между сэмплами и молчит. P_HINT_STATE отвечает на два
// вопроса на ОДНОЙ ширине — видна ли подсказка и листается ли рядом хоть что-нибудь, — и обе
// границы ищутся бисекцией: обе величины монотонны по ширине, поэтому граница находится точно.
const P_HINT_STATE = () => {
  const RE = /листайте|пролистайте|прокрут|скролл|swipe|scroll (right|horizontally)|шире экрана|вправо\s*[→>]|[→>]\s*вправо/i;
  const scrollable = el => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowX) || /(auto|scroll)/.test(cs.overflow);
  };
  let hint = false, scrolls = false, text = '';
  document.querySelectorAll('body *').forEach(el => {
    if (el.children.length) return;
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length > 120 || !RE.test(txt)) return;
    const vis = !el.checkVisibility || el.checkVisibility();
    if (vis) { hint = true; text = txt.slice(0, 60); }
    const zone = [];
    let p = el.parentElement, hops = 0;
    while (p && hops++ < 3) { zone.push(p, ...p.querySelectorAll('*')); p = p.parentElement; }
    if ([...new Set(zone)].filter(scrollable).some(b => b.scrollWidth > b.clientWidth + 1)) scrolls = true;
  });
  return { hint, scrolls, text };
};

const stripJs = async page => {
  await page.route('**/*', async route => {
    const req = route.request();
    // Скрипт отдаём пустым, а не abort'ом: оборванный запрос сам печатает в консоль
    // «Failed to load resource: net::ERR_FAILED», и проба ловит собственный след
    // как ошибку страницы. Пустое тело даёт тот же noJS без этого шума.
    if (req.resourceType() === 'script') {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }).catch(() => {});
    }
    if (req.resourceType() === 'document') {
      // Один срыв соединения не имеет права ронять весь прогон. route.fetch падает
      // на ровном месте (ECONNRESET на keep-alive, который сервер закрыл по таймауту
      // между двумя ширинами), и необработанный промис убивает процесс — снаружи это
      // выглядит как «qa.mjs не вернул JSON», без единого намёка на причину.
      // Пробуем дважды, а если и это не вышло — отдаём запрос браузеру как есть:
      // скрипты в этом документе останутся, режим noJS для него неточен, но
      // проверка доходит до конца и говорит, что нашла.
      for (let i = 0; i < 2; i++) {
        try {
          const r = await route.fetch();
          const body = (await r.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
          return await route.fulfill({ response: r, body });
        } catch (e) {
          if (i === 1) break;
          await new Promise(t => setTimeout(t, 300));
        }
      }
      return route.continue().catch(() => {});
    }
    return route.continue().catch(() => {});
  });
};

const browser = await chromium.launch();

// Адрес секции у каждого хита + опциональное сужение проб до одной секции.
// Ставится init-скриптом на КАЖДУЮ страницу разом — иначе пришлось бы править два десятка проб.
// window.__qaAddr(el) — ближайший предок с id либо section/article/main/header/footer.
// window.__qaBody()   — настоящий <body>: под --scope document.body подменён на корень зоны,
//                       и местам, которым нужен именно документ (iframe-эталон, скролл), нужен оригинал.
const INIT = (SCOPE_SEL) => {
  const bodyDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'body');
  const qs = Document.prototype.querySelector, qsa = Document.prototype.querySelectorAll;
  window.__qaBody = () => bodyDesc.get.call(document);
  window.__qaAddr = el => {
    let n = el;
    while (n && n.nodeType === 1 && n !== bodyDesc.get.call(document)) {
      if (n.id) return ' @#' + n.id;
      if (/^(SECTION|ARTICLE|MAIN|HEADER|FOOTER)$/.test(n.tagName))
        return ' @' + n.tagName + (n.classList[0] ? '.' + n.classList[0] : '');
      n = n.parentElement;
    }
    return '';
  };
  if (!SCOPE_SEL) return;
  let cached = null;
  const root = () => {
    if (cached && cached.isConnected) return cached;
    cached = qs.call(document, SCOPE_SEL);
    return cached;
  };
  window.__qaScope = SCOPE_SEL;
  window.__qaRoot = root;
  Object.defineProperty(document, 'body', {
    configurable: true, get: () => root() || bodyDesc.get.call(document)
  });
  document.querySelector = function (s) {
    const r = root(); if (!r) return qs.call(document, s);
    return (r.matches(s) ? r : null) || r.querySelector(s);
  };
  document.querySelectorAll = function (s) {
    const r = root(); if (!r) return qsa.call(document, s);
    const inner = [...r.querySelectorAll(s)];
    return r.matches(s) ? [r, ...inner] : inner;
  };
};
{
  const _newPage = browser.newPage.bind(browser);
  browser.newPage = async opts => {
    const p = await _newPage(opts);
    await p.addInitScript(INIT, SCOPE);
    return p;
  };
}

const lines = [];
const say = s => { lines.push(s); if (!AS_JSON) console.log(s); };

// --- 1. переполнение
say('── 1. ПЕРЕПОЛНЕНИЕ ─────────────────────────────────');
const earlyErrs = new Set();          // ошибки, пойманные до того, как заработал общий слушатель
const modes = SKIP_NOJS ? ['JS'] : ['JS', 'noJS'];
const scrollRegionSeen = new Map();
for (const mode of modes) {
  for (const w of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    const errs = [];
    // Ошибка консоли — не переполнение, и на одиннадцати ширинах она одна и та же: если
    // засчитывать её здесь, один сломанный скрипт даёт 11 провалов чужой категории и топит
    // настоящие. Собираем в общий список — его разбирает отдельная проба в конце прогона.
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));
    if (mode === 'noJS') await stripJs(page);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(120);
    const r = await page.evaluate(P_OVERFLOW);
    const bad = [];
    if (r.docScroll > r.vw + 1) bad.push(`докскролл ${r.docScroll}/${r.vw}`);
    if (r.beyondViewport.length) bad.push(`за вьюпортом ${r.beyondViewport.length}`);
    if (r.beyondParent.length) bad.push(`за родителем ${r.beyondParent.length}`);
    if (r.zero.length) bad.push(`нулевые ${r.zero.length}`);
    if (r.faint.length) bad.push(`прозрачные ${r.faint.length}`);
    r.scrollRegions.forEach(s => scrollRegionSeen.set(s.el, s));
    if (bad.length) {
      fail('переполнение', `${mode} ${w}: ${bad.join(', ')}`);
      say(`  ✗ ${mode.padEnd(4)} ${String(w).padStart(4)} — ${bad.join(', ')}`);
      if (r.beyondViewport.length) say(`      ${JSON.stringify(r.beyondViewport.slice(0, 3))}`);
      if (r.beyondParent.length) say(`      ${JSON.stringify(r.beyondParent.slice(0, 3))}`);
      if (r.zero.length) say(`      нулевые: ${r.zero.slice(0, 4).join(', ')}`);
      if (r.faint.length) say(`      прозрачные: ${JSON.stringify(r.faint.slice(0, 3))}`);
    }
    errs.forEach(e => earlyErrs.add(e));
    await page.close();
  }
}
say(`  ${fails.filter(f => f.area === 'переполнение').length === 0
  ? `чисто на ${WIDTHS.length} ширинах × ${modes.length} режима` : 'см. выше'}`);
if (scrollRegionSeen.size) {
  say('  скролл-регионы (каждый должен быть намеренным):');
  for (const s of scrollRegionSeen.values()) {
    const problems = [];
    if (!s.hint) problems.push('нет подсказки о прокрутке');
    if (!s.focusable) problems.push('недоступен с клавиатуры (tabindex)');
    if (!s.stickyBgOk) problems.push('липкая ячейка с прозрачным фоном');
    say(`    ${s.el} ${s.sw}/${s.cw}${problems.length ? ' — ' + problems.join(', ') : ' — ок'}`);
    if (problems.length) note('скролл-регион', `${s.el}: ${problems.join(', ')}`);
  }
}

// --- одна страница на остальные проверки
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrs = [];
page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
page.on('pageerror', e => consoleErrs.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });

// --- 2. контраст
say('── 2. КОНТРАСТ (живой DOM) ─────────────────────────');
for (const w of [1280, 390]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(80);
  const c = await page.evaluate(P_CONTRAST);
  say(`  ${w}px: осмотрено ${c.checked} текстовых узлов, провалов ${c.violations.length}` +
      (c.overImage ? `, из них ${c.overImage} поверх градиента/картинки` : ''));
  c.violations.forEach(v => {
    const msg = `${w}px «${v.text}» ${v.ratio}:1 при ${v.need} (${v.fg} на ${v.bg}, ${v.fs}px)`;
    // Поверх градиента считанный фон — только нижний слой; это повод посмотреть, а не приговор.
    if (v.img) { note('контраст', msg + ' — текст лежит на градиенте/картинке, сверь глазом'); }
    else fail('контраст', msg);
    say(`    ${v.img ? '?' : '✗'} «${v.text}» ${v.ratio}:1 < ${v.need} — ${v.fg} на ${v.bg}, ${v.fs}px, ${v.el}`);
  });
}
await page.setViewportSize({ width: 1280, height: 900 });

// --- 3. фокус (свип по Tab)
say('── 3. ФОКУС ────────────────────────────────────────');
await page.evaluate(() => window.scrollTo(0, 0));
const noFocus = [];
const seenStops = new Set();
for (let i = 0; i < 200; i++) {
  await page.keyboard.press('Tab');
  const r = await page.evaluate(() => {
    const el = document.activeElement;
    // Настоящий <body>, а не корень зоны: под --scope document.body подменён, сравнение с ним
    // никогда не сработает — обход не кончается и записывает сам body как таб-стоп без фокуса.
    const realBody = window.__qaBody ? window.__qaBody() : document.body;
    if (!el || el === realBody) return null;
    const cs = getComputedStyle(el);
    const key = el.tagName + (el.id ? '#' + el.id : '') + (el.classList[0] ? '.' + el.classList[0] : '') +
      (el.textContent || '').trim().slice(0, 12);
    const marked = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
      cs.boxShadow !== 'none' || cs.textDecorationLine.includes('underline');
    // Tab ходит по всей странице; под --scope стопы вне зоны считаются чужими и не судятся.
    const root = window.__qaRoot ? window.__qaRoot() : null;
    const inZone = !root || root === el || root.contains(el);
    return { key, marked, inZone, visible: el.matches(':focus-visible') };
  });
  if (!r) break;
  if (seenStops.has(r.key)) break;
  seenStops.add(r.key);
  if (!r.marked && r.inZone) noFocus.push(r.key);
}
if (noFocus.length) {
  fail('фокус', `без видимого индикатора: ${noFocus.slice(0, 6).join(', ')}`);
  say(`  ✗ без индикатора ${noFocus.length}: ${noFocus.slice(0, 6).join(', ')}`);
} else say(`  все ${seenStops.size} таб-стопов помечены видимым фокусом`);

// --- 4. reduced-motion
say('── 4. PREFERS-REDUCED-MOTION ───────────────────────');
{
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p2.emulateMedia({ reducedMotion: 'reduce' });
  await p2.goto(url, { waitUntil: 'networkidle' });
  await p2.evaluate(() => window.scrollTo(0, (window.__qaBody ? window.__qaBody() : document.body).scrollHeight));
  await p2.waitForTimeout(700);
  const anim = await p2.evaluate(() =>
    document.getAnimations().filter(a => a.playState === 'running')
      .map(a => (a.effect && a.effect.target ? a.effect.target.tagName : '?')).slice(0, 8));
  if (anim.length) {
    fail('reduced-motion', `играет ${anim.length} анимаций: ${anim.join(', ')}`);
    say(`  ✗ играет ${anim.length}: ${anim.join(', ')}`);
  } else say('  0 анимаций — верно');
  await p2.close();
}

// --- 5. форма
say('── 5. ФОРМА ────────────────────────────────────────');
const hasForm = await page.$('form');
if (!hasForm) say('  формы нет — пропуск');
else {
  const submit = await page.$('form button[type=submit], form input[type=submit], form button:not([type])');
  if (submit) { await submit.click().catch(() => {}); await page.waitForTimeout(400); }
  const inv = await page.evaluate(P_FORM);
  const seenGroup = new Set();
  for (const f of inv) {
    const bad = [];
    if (!f.label) bad.push('нет label');
    if (['text', 'email', 'tel', 'password', 'url', 'search'].includes(f.type) && f.autocomplete === '—')
      bad.push('нет autocomplete');
    if (['tel', 'number', 'email'].includes(f.type) && f.inputmode === '—')
      bad.push('нет inputmode');
    if (f.invalid === 'true' && !f.descs.length) bad.push('aria-invalid без aria-describedby');
    f.descs.filter(d => d.missing).forEach(d => bad.push(`aria-describedby="${d.id}" ведёт в никуда`));
    if (f.invalid === 'true' && f.descs.some(d => d.visible === false))
      bad.push('текст ошибки скрыт от глаз, но объявлен полю');
    if (bad.length) {
      fail('форма', `${f.id}: ${bad.join(', ')}`);
      say(`  ✗ ${f.id} (${f.type}) — ${bad.join(', ')}`);
    } else {
      const d = f.descs.map(x => `«${x.text}»`).join(' ');
      say(`  ✓ ${f.id.padEnd(12)} ${f.type.padEnd(10)} ac=${f.autocomplete} im=${f.inputmode}` +
          (f.invalid === 'true' ? ` → ${d}` : ''));
    }
    if (f.type === 'radio' && !f.grouped && !seenGroup.has(f.id)) {
      seenGroup.add(f.id);
      fail('форма', `radio «${f.id}» вне fieldset — группа не озвучивается`);
    }
  }
}

// --- 6. фигуры
say('── 6. ТЕКСТ В ФИГУРАХ ──────────────────────────────');
{
  const shapes = [];
  for (const w of [1280, 390, 320]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(80);
    shapes.push([w, await page.evaluate(P_SHAPES)]);
  }
  if (!shapes.some(([, s]) => s.length)) say('  фигур с текстом не найдено');
  for (const [w, list] of shapes) {
    for (const s of list) {
      for (const word of s.words) {
        if (word.lines > 1) {
          fail('фигура', `${w}px: «${word.w}» в ${s.el} разорвано на ${word.lines} строки`);
          say(`  ✗ ${w}px ${s.el}: «${word.w}» на ${word.lines} строки — перенос в фигуре читается как брак`);
        } else if (word.px > s.inner + 0.5) {
          fail('фигура', `${w}px: «${word.w}» ${word.px}px против ${s.inner}px внутри ${s.el}`);
          say(`  ✗ ${w}px ${s.el}: «${word.w}» ${word.px}px > ${s.inner}px внутренних`);
        }
      }
    }
  }
  const ok = !fails.some(f => f.area === 'фигура');
  if (ok && shapes.some(([, s]) => s.length))
    say(`  ${shapes[0][1].length} фигур, все слова в одну строку с запасом`);
}

// --- 7. ложные подсказки
say('── 7. ПОДСКАЗКИ, КОТОРЫЕ ВРУТ ──────────────────────');
{
  let seen = 0;
  for (const w of WIDTHS) {
    const p3 = await browser.newPage({ viewport: { width: w, height: 900 } });
    await p3.goto(url, { waitUntil: 'networkidle' });
    await p3.waitForTimeout(120);
    const lies = await p3.evaluate(P_CLAIM);
    for (const l of lies) {
      seen++;
      fail('подсказка', `${w}px: «${l.text}» — ${l.verdict}`);
      say(`  ✗ ${String(w).padStart(4)} «${l.text}» — ${l.verdict}`);
    }
    await p3.close();
  }
  // Граница медиазапроса между сэмплами: ищем точную ширину, где подсказка гаснет,
  // и точную, где прокрутка кончается. Совпали — гейт написан по факту; разошлись —
  // на ширинах между ними подсказка врёт, и ни один из 11 сэмплов туда мог не попасть.
  const pB = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await pB.goto(url, { waitUntil: 'networkidle' });
  const at = async w => { await pB.setViewportSize({ width: w, height: 900 }); await pB.waitForTimeout(60); return pB.evaluate(P_HINT_STATE); };
  const lastTrue = async pick => {                       // наибольшая ширина, где признак ещё есть
    let lo = 320, hi = 1600;
    if (!pick(await at(lo))) return null;                // признака нет даже на самой узкой
    if (pick(await at(hi))) return hi;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; (pick(await at(mid)) ? lo = mid : hi = mid); }
    return lo;
  };
  const tHint = await lastTrue(r => r.hint);
  const tScroll = await lastTrue(r => r.scrolls);
  const label = (await at(tHint || 390)).text;
  await pB.close();
  if (tHint !== null && tHint > (tScroll === null ? 0 : tScroll)) {
    seen++;
    const from = (tScroll === null ? 320 : tScroll + 1);
    fail('подсказка', `${from}–${tHint}px: «${label}» видна, но ничего не листается (прокрутка кончается на ${tScroll === null ? 'любой ширине' : tScroll + 'px'}, подсказка гаснет только после ${tHint}px)`);
    say(`  ✗ граница: подсказка держится до ${tHint}px, а листается только до ${tScroll === null ? '—' : tScroll}px — врёт на ${from}–${tHint}px`);
  } else if (tHint !== null) {
    say(`  граница точная: и подсказка, и прокрутка кончаются на ${tHint}px`);
  }
  if (!seen) say(`  подсказок о прокрутке, ложных хоть на одной из ${WIDTHS.length} ширин, нет`);
}

// 21. Контрол снял системный вид, но в пустом состоянии рисует то же самое.
// Раздел 8 такой контрол пропускает: там достаточно, чтобы стили отличались от голого
// дефолта хоть чем-нибудь. Но глаз читает не diff со стилями браузера, а картинку:
// квадрат 18px, серая волосяная линия 1px, радиус 3px — это и есть описание дефолта,
// сколько бы appearance:none над ним ни стояло. Два слепых критика подряд, глядя на
// кроп 1:1, независимо назвали такую форму «вставленными системными компонентами».
// Поэтому здесь спрашивается обратное: есть ли у контрола в ПУСТОМ состоянии хоть один
// признак, которого у дефолта не бывает, — толщина от 2px, размер вне 12–19px,
// хроматичная (не серая) линия, своя тень или заметно небелое поле.
// Плюс ручка resize у textarea: единственная деталь формы, которую браузер рисует сам
// и которую нельзя перекрасить, — три диагональные риски в чужой серой гамме.
// Подписи формы образуют колонку, и колонка держится ровно до тех пор, пока все они
// начинаются с одной вертикали. Разъезд рождается не из небрежности, а из декора: рамка
// fieldset, полоска-акцент, иконка перед словом добавляют элементу свой отступ, и одна
// подпись уезжает на десяток пикселей. Такой сдвиг слишком мал, чтобы прочитаться как
// вторая колонка, и слишком велик, чтобы не заметить: глаз видит выпавшую строку.
const P_ROWEDGE = () => {
  const out = [];
  for (const form of document.querySelectorAll('form')) {
    const items = [];
    for (const el of form.querySelectorAll('label, legend')) {
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      const t = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 32);
      if (!t) continue;
      items.push({ t, left: Math.round(b.left) });
    }
    if (items.length < 4) continue;
    const tally = {};
    for (const it of items) tally[it.left] = (tally[it.left] || 0) + 1;
    const base = Number(Object.keys(tally).sort((a, b) => tally[b] - tally[a] || a - b)[0]);
    if (tally[base] < 3) continue;  // общей колонки нет — сравнивать не с чем
    // Сдвиг до 23px — это разъезд: слишком мал, чтобы прочитаться как вложенность или
    // вторая колонка, и достаточно велик, чтобы глаз увидел выпавшую строку. От 24px
    // отступ читается как намеренная вложенность и дефектом не считается.
    const bad = {};
    for (const it of items) {
      const d = Math.abs(it.left - base);
      if (d >= 1 && d <= 23) (bad[it.left] = bad[it.left] || []).push(it.t);
    }
    for (const left of Object.keys(bad))
      out.push({ t: bad[left].join('», «'), left: Number(left), base, d: Math.abs(left - base) });
  }
  return out;
};

// Одноранговые подписи держат ряд весом: семь заголовков строк в таблице, пункты одного
// списка, названия карточек одной сетки читаются как ряд ровно до тех пор, пока начертание
// у них общее. Выпадение ровно на одну ступень — 600 против 500, 500 против 400 — самое
// коварное: для другого ранга этого мало, глаз не читает его как «здесь другое», но
// достаточно, чтобы строка показалась недоделанной. Обычно так помечают особый случай
// (итог, надбавку, сноску), ослабляя подпись, — хотя отдельность уже держат линия, место
// в подвале или отступ, и ослабление остаётся лишним шумом.
const P_WSTEP = () => {
  const box = el => el.closest('table, ul, ol, dl, nav, form, section, article') || document.body;
  const cls = el => [...el.classList].filter(c => !c.includes('--') && !/^(is|has|js)-/.test(c)).sort().join('.');
  const groups = new Map();
  for (const el of document.querySelectorAll('*')) {
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 100) continue;
    const c = getComputedStyle(el);
    const w = parseInt(c.fontWeight, 10);
    if (!w) continue;
    const b = box(el);
    let key = groups.get(b);
    if (!key) groups.set(b, key = new Map());
    // Роль входит в ключ наравне с классом: заголовок колонки и заголовок строки — разные
    // ряды, и мешать их в один значит сравнивать шапку таблицы с её телом.
    const k = el.tagName + '.' + cls(el) + '/' + (el.getAttribute('scope') || el.getAttribute('role') || '');
    (key.get(k) || key.set(k, []).get(k)).push({ el, w, t: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28) });
  }
  const out = [];
  for (const [, byTag] of groups) {
    for (const [k, members] of byTag) {
      if (members.length < 5) continue;
      const tally = {};
      for (const m of members) tally[m.w] = (tally[m.w] || 0) + 1;
      const base = Number(Object.keys(tally).sort((a, b) => tally[b] - tally[a] || b - a)[0]);
      const odd = members.filter(m => Math.abs(m.w - base) === 100);
      // Ровно один выпавший — это сбой. Двое и больше с одним и тем же весом означают
      // осознанное деление ряда надвое, и трогать его проба права не имеет.
      if (odd.length !== 1) continue;
      if (tally[base] < members.length - 1) continue;
      out.push({ t: odd[0].t, w: odd[0].w, base, n: members.length, k: k.replace(/\.$/, '') });
    }
  }
  return out;
};

// Поставленные в строку кнопки честно берут ширину по своей подписи: край каждой задаёт
// сосед справа, и разная длина не читается вовсе. Перенесённые в столбик — на узком экране,
// в сайдбаре, в модальном окне — те же кнопки встают на общий левый край, и разница ширин
// вылезает правым краем. Разница в несколько процентов здесь худшая из возможных: для
// «намеренно разного размера» её мало, глаз не читает её как замысел, — но достаточно,
// чтобы столбик выглядел собранным на глаз. В колонке ширину задаёт колонка, а не длина
// подписи.
// Разделитель разрядов в числе — не пробел между словами, а тонкая шпация: он обязан быть уже
// межсловного пробела, иначе «1 400» перестаёт быть одним числом и читается как «1» и «400».
// Ловушка — моноширинный шрифт, взятый ради tabular-nums: в нём у пробела то же знакоместо,
// что у цифры, и любой символ-разделитель — обычный, тонкий, неразрывный — приходит к одной
// ширине. Подмена символа здесь не лечит ничего, лечит только word-spacing. Беда растёт с
// кеглем: в таблице на 15px дыра ещё читается как выравнивание колонки, в заголовке на 48px
// она уже вшестеро шире межсловного пробела соседнего абзаца.
// Липкая шапка и якорь спорят за одну и ту же полосу экрана: браузер ставит цель верхом в ноль,
// шапка стоит поверх — и посетитель после клика по меню видит не начало раздела, а его вторую
// строку, перерезанную шапкой пополам. Дефект не виден ни на одном обычном скриншоте: страница
// снимается сверху, а ломается только после перехода. Лечится не отступом в разметке, а полем
// прокрутки у корня — scroll-padding-top вычитает высоту шапки из точки остановки одинаково для
// клика по меню, ссылки снаружи и навигации с клавиатуры.
const P_ANCHOR = async () => {
  const stuck = [...document.querySelectorAll('*')].filter(el => {
    const c = getComputedStyle(el);
    if (c.position !== 'sticky' && c.position !== 'fixed') return false;
    const t = parseFloat(c.top);
    if (!(t <= 4)) return false;
    const r = el.getBoundingClientRect();
    // пин GSAP/ScrollTrigger делает секцию position:fixed на весь экран — это не шапка
    return r.height > 8 && r.height < innerHeight * 0.4 && r.width > innerWidth * 0.5;
  });
  if (!stuck.length) return [];
  const hdr = Math.max(...stuck.map(el => el.getBoundingClientRect().height));
  const st = document.createElement('style');
  st.textContent = 'html,*{scroll-behavior:auto !important}';
  document.head.appendChild(st);
  const wasY = scrollY, wasHash = location.hash;
  const out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    const href = a.getAttribute('href');
    if (!href || href.length < 2) continue;
    const id = decodeURIComponent(href.slice(1));
    if (seen.has(id)) continue;
    seen.add(id);
    const t = document.getElementById(id) || document.getElementsByName(id)[0];
    if (!t) continue;
    // Якорь «наверх» ведут на саму липкую шапку (id висит на <header>): её верх после перехода
    // всегда ноль, потому что она прилипла, — и любая проверка «цель под шапкой» на ней сработает
    // вхолостую. Это не дефект: посетитель попал ровно туда, куда просил, — в начало документа.
    if (stuck.some(s => s === t || s.contains(t) || t.contains(s))) continue;
    // якорь «наверх» и skip-link ведут к самому началу документа: там шапка поверх начала — норма
    const abs = t.getBoundingClientRect().top + scrollY;
    if (abs < hdr + 8) continue;
    location.hash = '#' + id;
    await new Promise(r => setTimeout(r, 120));
    const top = t.getBoundingClientRect().top;
    if (top < hdr - 1) {
      const sm = Math.round(parseFloat(getComputedStyle(t).scrollMarginTop) || 0);
      out.push({ id, hidden: Math.round(hdr - top), hdr: Math.round(hdr), sm });
    }
    if (out.length >= 5) break;
  }
  scrollTo(0, wasY);
  history.replaceState(null, '', location.pathname + location.search + wasHash);
  st.remove();
  return out;
};

const P_DIGIT = () => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = walk.nextNode())) {
    const m = /\d([\s\u00a0\u2009\u202f])\d\d\d(?!\d)/.exec(n.nodeValue || '');
    if (!m) continue;
    const el = n.parentElement;
    if (!el) continue;
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden') continue;
    const fs = parseFloat(c.fontSize);
    if (!(fs >= 12)) continue;
    const r = document.createRange();
    const i = m.index + 1;
    r.setStart(n, i); r.setEnd(n, i + 1);
    const sp = r.getBoundingClientRect().width;
    r.setStart(n, m.index); r.setEnd(n, m.index + 1);
    const dg = r.getBoundingClientRect().width;
    if (!(dg > 0)) continue;
    // Мерить долями цифры нельзя: в пропорциональном шрифте цифра узкая, и обычный пробел
    // в 0.28em выходит 0.6 её ширины — то есть норма выглядит нарушением. Порог живёт в em:
    // шпация канонически 0.16–0.33em, 0.4em — с запасом. Моноширинный пробел даёт 0.6em.
    if (sp / fs <= 0.4) continue;
    const k = el.tagName + '.' + [...el.classList].join('.') + '|' + Math.round(fs);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      t: (n.nodeValue || '').trim().replace(/\s+/g, ' ').slice(0, 24),
      k: k.split('|')[0].replace(/\.$/, ''),
      fs: Math.round(fs), sp: Math.round(sp * 10) / 10, dg: Math.round(dg * 10) / 10,
      ratio: Math.round((sp / fs) * 100) / 100
    });
  }
  return out.slice(0, 6);
};

const P_CUR = () => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = walk.nextNode())) {
    const m = /\d([    ])([₽$€£¥₸₴])/.exec(n.nodeValue || '');
    if (!m) continue;
    const el = n.parentElement;
    if (!el) continue;
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden') continue;
    const fs = parseFloat(c.fontSize);
    if (!(fs >= 12)) continue;
    const r = document.createRange();
    const i = m.index + 1;
    r.setStart(n, i); r.setEnd(n, i + 1);
    const sp = r.getBoundingClientRect().width;
    // Пробел в конце строки схлопнут в нуль — это перенос, а не сжатие: не судим.
    r.setStart(n, m.index); r.setEnd(n, m.index + 2);
    const rects = r.getClientRects();
    if (rects.length > 1) continue;
    if (!(sp > 0)) continue;
    // Автор поставил пробел — значит просвет задуман. Обычный пробел 0.2–0.3em;
    // ниже 0.14em он читается как слипание, и виноват почти всегда word-spacing.
    if (sp / fs >= 0.14) continue;
    const k = el.tagName + '.' + [...el.classList].join('.') + '|' + Math.round(fs);
    if (seen.has(k)) continue;
    seen.add(k);
    const par = el.parentElement;
    out.push({
      t: (n.nodeValue || '').trim().replace(/\s+/g, ' ').slice(0, 24),
      k: k.split('|')[0].replace(/\.$/, ''),
      fs: Math.round(fs), sp: Math.round(sp * 10) / 10,
      ratio: Math.round((sp / fs) * 100) / 100,
      ws: c.wordSpacing,
      from: par && getComputedStyle(par).wordSpacing === c.wordSpacing ? par.tagName + '.' + [...par.classList].join('.') : ''
    });
  }
  return out.slice(0, 6);
};

const P_ROUND = () => {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('*')) {
    const c = getComputedStyle(el);
    // Процентный радиус — заявка «это круг». Пилюля набирается в px/em и сюда не попадает.
    if (!/^\d+(\.\d+)?%/.test(c.borderTopLeftRadius)) continue;
    if (parseFloat(c.borderTopLeftRadius) < 40) continue;
    if (c.display === 'none' || c.visibility === 'hidden') continue;
    const t = (el.textContent || '').trim();
    if (!t || t.length > 6) continue;           // значок с цифрой/буквой, не декоративный блоб
    if (el.querySelector('img,svg')) continue;
    const r = el.getBoundingClientRect();
    const mx = Math.max(r.width, r.height), mn = Math.min(r.width, r.height);
    if (mn < 20 || mx > 160) continue;
    const skew = (mx - mn) / mx;
    if (skew <= 0.08) continue;                  // круг в пределах допуска — не судим
    const k = el.tagName + '.' + [...el.classList].join('.');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      t: t.slice(0, 6), k: k.replace(/\.$/, ''),
      w: Math.round(r.width), h: Math.round(r.height),
      skew: Math.round(skew * 100),
      sized: c.width !== 'auto' && c.height !== 'auto' ? 'да' : 'нет'
    });
  }
  return out.slice(0, 6);
};

const P_HIER_MARK = () => {
  const out = [];
  let i = 0;
  for (const sec of document.querySelectorAll('section,article')) {
    const h = sec.querySelector(':scope > h2, :scope > header > h2, :scope > div > h2');
    if (!h) continue;
    const kid = [...sec.querySelectorAll('h3, summary')][0];
    if (!kid || kid === h) continue;
    const ch = getComputedStyle(h), ck = getComputedStyle(kid);
    if (ch.display === 'none' || ck.display === 'none') continue;
    const fh = parseFloat(ch.fontSize), fk = parseFloat(ck.fontSize);
    if (!(fh > 0 && fk > 0)) continue;
    h.dataset.qaHier = kid.dataset.qaHier = String(i);
    out.push({ i, h: h.textContent.trim().replace(/\s+/g, ' ').slice(0, 22),
               k: kid.textContent.trim().replace(/\s+/g, ' ').slice(0, 22), fh, fk });
    i++;
  }
  return out;
};

const P_HIER_CHECK = (wide) => {
  const out = [];
  for (const w of wide) {
    const h = document.querySelector(`[data-qa-hier="${w.i}"]`);
    const kid = [...document.querySelectorAll(`[data-qa-hier="${w.i}"]`)][1];
    if (!h || !kid) continue;
    const fh = parseFloat(getComputedStyle(h).fontSize), fk = parseFloat(getComputedStyle(kid).fontSize);
    if (!(fh > 0 && fk > 0)) continue;
    const rW = w.fh / w.fk, rN = fh / fk;
    // Иерархия жива, пока заголовок раздела заметно крупнее заголовка внутри него.
    if (rN >= 1.3) continue;
    // И судим только падение: если на широком было так же тесно, это ровный замысел, не адаптив.
    if (rN / rW > 0.85) continue;
    out.push({ h: w.h, k: w.k, wideH: w.fh, wideK: w.fk, nH: Math.round(fh * 10) / 10, nK: Math.round(fk * 10) / 10,
               rW: Math.round(rW * 100) / 100, rN: Math.round(rN * 100) / 100 });
  }
  return out.slice(0, 4);
};

const P_HOLLOW = () => {
  // Пустое поле, у которого нет ни плоскости, ни замкнутого контура, ни примера ввода,
  // ничем не занимает свою площадь: видна одна черта снизу, а над ней — фон секции.
  // Глаз читает такую строку как подпись с линейкой, а не как место, куда пишут:
  // форма перестаёт выглядеть формой ровно в том состоянии, в котором её видят все —
  // до первого клика. Опора нужна хотя бы одна: различимая заливка, контур из трёх
  // сторон и больше, или placeholder, который занимает площадь примером ввода.
  const MIN_FILL = 1.2;      // ниже — заливки нет
  const MIN_LINE = 1.5;      // ниже — линия рамки не читается
  const MIN_SIDES = 3;       // меньше — контур не замкнут
  const lum = c => {
    const m = (c || '').match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    if (m.length > 3 && Number(m[3]) < 0.5) return null;
    const [r, g, b] = m.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, z) => { const l1 = lum(a), l2 = lum(z); if (l1 === null || l2 === null) return null;
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const behind = el => { let n = el.parentElement;
    while (n) { const c = getComputedStyle(n).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)') return c; n = n.parentElement; }
    return 'rgb(255, 255, 255)'; };
  const label = el => {
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return (l.innerText || l.textContent || '').trim(); }
    const l = el.closest('label');
    return l ? (l.innerText || l.textContent || '').trim() : (el.name || el.tagName);
  };
  const out = [];
  for (const el of document.querySelectorAll('input, textarea')) {
    const t = (el.type || '').toLowerCase();
    if (['checkbox', 'radio', 'hidden', 'submit', 'button', 'reset', 'image', 'range', 'color', 'file', 'date', 'time', 'datetime-local', 'month', 'week'].includes(t)) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 40 || r.height < 16) continue;
    if (el.value || el.placeholder) continue;                       // площадь занята текстом
    const back = behind(el);
    const kFill = ratio(cs.backgroundColor, back);
    if (kFill !== null && kFill >= MIN_FILL) continue;              // плоскость есть
    const sides = ['Top', 'Right', 'Bottom', 'Left'].filter(s => {
      if (cs['border' + s + 'Style'] === 'none') return false;
      if (parseFloat(cs['border' + s + 'Width']) < 1) return false;
      const k = ratio(cs['border' + s + 'Color'], back);
      return k !== null && k >= MIN_LINE;
    });
    if (sides.length >= MIN_SIDES) continue;                        // контур замкнут
    out.push({ t: label(el).replace(/\s+/g, ' ').slice(0, 28), w: Math.round(r.width), h: Math.round(r.height),
      fill: kFill === null ? 'нет' : kFill.toFixed(2) + ':1', sides: sides.length ? sides.join('+') : 'ни одной' });
  }
  return out;
};

const P_LINK = () => {
  // Ссылка внутри абзаца отличается от соседнего текста только оттенком цвета: ни подчёркивания,
  // ни веса, ни фона. Цвет — единственный признак, и он же самый слабый: его не видят при плохом
  // экране, при дальтонизме и просто при беглом чтении. Ссылка становится ссылкой только под
  // курсором, а на телефоне курсора нет вовсе — там её не найти никогда.
  const MIN_K = 3;      // контраст цвета ссылки к цвету соседнего текста
  const MIN_OWN = 20;   // столько собственного текста у родителя = ссылка стоит внутри прозы
  const lum = c => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(',').map(parseFloat);
    if (p.length > 3 && p[3] < 0.5) return null;
    const [r, g, b] = p.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, z) => {
    const x = lum(a), y = lum(z);
    if (x === null || y === null) return null;
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const alpha = c => { const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(c || ''); return m ? parseFloat(m[1]) : 1; };
  const out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const p = a.parentElement;
    if (!p) continue;
    // в меню, шапке и подвале ссылками является всё подряд — там их и ищут
    if (a.closest('nav, header, footer, menu, [role=navigation]')) continue;
    const cs = getComputedStyle(a), ps = getComputedStyle(p);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = a.getBoundingClientRect();
    if (r.width < 8 || r.height < 6) continue;
    const txt = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    // ссылка-кнопка и ссылка-карточка узнаются формой, а не цветом
    if (cs.display !== 'inline' && cs.display !== 'inline-block' && cs.display !== 'contents') continue;
    if (cs.display === 'inline-block' && parseFloat(cs.paddingLeft) >= 8) continue;
    // ссылка должна стоять внутри прозы: у родителя есть собственный текст помимо ссылок
    let own = 0;
    for (const n of p.childNodes) if (n.nodeType === 3) own += (n.nodeValue || '').trim().length;
    if (own < MIN_OWN) continue;
    // любой признак, кроме цвета, снимает вопрос
    if (/underline|line-through|overline/.test(cs.textDecorationLine || '')) continue;
    if (cs.borderBottomStyle !== 'none' && parseFloat(cs.borderBottomWidth) >= 1) continue;
    if ((cs.backgroundImage || 'none') !== 'none') continue;              // подчёркивание градиентом
    if (alpha(cs.backgroundColor) > 0.1 && cs.backgroundColor !== ps.backgroundColor) continue;
    if (Math.abs((parseInt(cs.fontWeight) || 400) - (parseInt(ps.fontWeight) || 400)) >= 100) continue;
    if (cs.fontStyle !== ps.fontStyle || cs.fontFamily !== ps.fontFamily) continue;
    if (Math.abs(parseFloat(cs.fontSize) - parseFloat(ps.fontSize)) >= 1) continue;
    if (cs.textTransform !== ps.textTransform) continue;
    for (const pe of ['::before', '::after']) {
      const q = getComputedStyle(a, pe);
      if (q.content && q.content !== 'none' && q.content !== 'normal') { own = -1; break; }
    }
    if (own < 0) continue;
    const k = ratio(cs.color, ps.color);
    if (k === null || k >= MIN_K) continue;
    const key = txt.slice(0, 24) + '|' + cs.color;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ t: txt.slice(0, 32), k: k.toFixed(2) });
  }
  return out;
};

const P_CLIP = () => {
  const MIN_HID = 8;    // столько пикселей текста спрятано, чтобы это была обрезка, а не погрешность
  const MIN_TXT = 20;   // столько собственного текста = это абзац, а не декоративный контейнер
  const out = [], seen = new Set();
  const clickable = el => {
    let n = el, d = 0;
    while (n && d++ < 3) { const t = n.tagName; if (t === 'A' || t === 'BUTTON' || t === 'SUMMARY') return true; n = n.parentElement; }
    return !!el.querySelector('a[href], button, summary, [aria-expanded]');
  };
  for (const el of document.querySelectorAll('*')) {
    const t = el.tagName;
    if (/^(INPUT|SELECT|OPTION|TEXTAREA|SVG|CANVAS|IMG|VIDEO|IFRAME|HTML|BODY)$/.test(t)) continue;
    if (el.closest('svg')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 8) continue;
    let own = 0;
    for (const n of el.childNodes) if (n.nodeType === 3) own += (n.nodeValue || '').trim().length;
    const clamp = parseInt(cs.webkitLineClamp || '') || 0;
    const ell = (cs.textOverflow || '') === 'ellipsis' && cs.overflowX !== 'visible';
    const hidX = el.scrollWidth - el.clientWidth;
    const hidY = el.scrollHeight - el.clientHeight;
    let how = null, hid = 0;
    if (ell && hidX >= MIN_HID) { how = 'в строку'; hid = hidX; }
    else if (clamp && hidY >= MIN_HID) { how = `${clamp} строк${clamp === 1 ? 'а' : ''}`; hid = hidY; }
    else if (own >= MIN_TXT && cs.overflowY === 'hidden' && hidY >= MIN_HID) { how = 'по высоте'; hid = hidY; }
    if (!how) continue;
    if (!ell && !clamp && own < MIN_TXT) continue;
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt.length < 4) continue;
    const ttl = (el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
    if (ttl.length >= txt.length * 0.9) continue;   // полный текст доступен в подсказке
    if (clickable(el)) continue;                    // есть куда нажать и дочитать
    const key = txt.slice(0, 24) + '|' + how;
    if (seen.has(key)) continue; seen.add(key);
    out.push({ t: txt.slice(0, 40), how, hid: Math.round(hid) });
  }
  return out;
};

const P_STACK = () => {
  const parse = c => { const m = String(c).match(/[\d.]+/g); return m ? m.map(Number) : null; };
  // Плашка — то, у чего есть собственный видимый край: заливка или рамка. Абзацы и заголовки
  // такой пробе не подсудны: их ширину задаёт блочный поток, и она уже общая.
  const plate = el => {
    const c = getComputedStyle(el);
    const bg = parse(c.backgroundColor);
    if (bg && (bg.length < 4 || bg[3] >= 0.3)) return true;
    if (c.backgroundImage && c.backgroundImage !== 'none') return true;
    for (const S of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(c['border' + S + 'Width']) >= 1 && c['border' + S + 'Style'] !== 'none') {
        const bc = parse(c['border' + S + 'Color']);
        if (bc && (bc.length < 4 || bc[3] >= 0.3)) return true;
      }
    }
    return false;
  };
  const cls = el => [...el.classList].filter(c => !c.includes('--') && !/^(is|has|js)-/.test(c)).sort().join('.');
  const out = [];
  for (const parent of document.querySelectorAll('*')) {
    const kids = [...parent.children].filter(k => {
      const c = getComputedStyle(k);
      if (c.display === 'none' || c.visibility === 'hidden' || c.position === 'absolute' || c.position === 'fixed') return false;
      const r = k.getBoundingClientRect();
      return r.width >= 60 && r.height >= 24 && plate(k);
    });
    if (kids.length < 2) continue;
    const groups = new Map();
    for (const k of kids) {
      const key = k.tagName + '.' + cls(k);
      (groups.get(key) || groups.set(key, []).get(key)).push(k);
    }
    for (const [key, members] of groups) {
      if (members.length < 2) continue;
      const rects = members.map(m => m.getBoundingClientRect());
      // Столбик, а не строка: общий левый край и ни одной пары, перекрывающейся по высоте.
      const lefts = rects.map(r => r.left);
      if (Math.max(...lefts) - Math.min(...lefts) > 2) continue;
      const stacked = rects.every((r, i) => rects.every((q, j) =>
        i === j || r.bottom <= q.top + 1 || q.bottom <= r.top + 1));
      if (!stacked) continue;
      const ws = rects.map(r => r.width);
      const span = Math.max(...ws) - Math.min(...ws);
      // Больше четверти — это уже читается как намеренно разный размер, и проба молчит.
      // Ровно так же молчит совпадение до пикселя. Ловится только «почти».
      if (span <= 2 || span > Math.max(...ws) * 0.25) continue;
      out.push({
        k: key.replace(/\.$/, ''), n: members.length,
        ws: ws.map(w => Math.round(w)),
        span: Math.round(span),
        t: (members[0].innerText || members[0].textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
      });
    }
  }
  return out.slice(0, 6);
};

const P_WRAP = () => {
  // Ряд равноправных пунктов — меню, вкладки, цепочка ссылок — держится тем, что каждый
  // пункт занимает одну строку. Когда ряду становится тесно, он не ломается громко: пункты
  // начинают переносить слова внутри себя, и в одной строке оказываются соседи в одну, в две
  // и в три строки. Переполнения нет, контраста хватает, мишень крупная — механически всё
  // цело, а глаз вместо меню видит рваную серую кашу. Ровный ряд, где все пункты в две
  // строки, — это решение; рваный — это «места не хватило, и никто не посмотрел».
  const vis = el => { const c = getComputedStyle(el), r = el.getBoundingClientRect();
    return c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05 && r.width > 0 && r.height > 0; };
  // Число строк считаем по разным вершинам прямоугольников содержимого, а не делением
  // height на line-height: падинг и разный кегль внутри пункта дают ложные полстроки.
  const lines = el => {
    const rg = document.createRange(); rg.selectNodeContents(el);
    const tops = new Set([...rg.getClientRects()].filter(r => r.width > 1 && r.height > 1)
      .map(r => Math.round(r.top)));
    return tops.size || 1;
  };
  const cls = el => [...el.classList].filter(c => !c.includes('--') && !/^(is|has|js)-/.test(c)).sort().join('.');
  const out = [];
  for (const parent of document.querySelectorAll('*')) {
    // Пункт ряда — короткая подпись. Абзац переносится по назначению, и мерить его нечего.
    const kids = [...parent.children].filter(k => {
      if (!vis(k)) return false;
      const c = getComputedStyle(k);
      if (c.position === 'absolute' || c.position === 'fixed') return false;
      const t = (k.textContent || '').trim().replace(/\s+/g, ' ');
      return t.length > 1 && t.length <= 40;
    });
    if (kids.length < 3) continue;
    const groups = new Map();
    for (const k of kids) {
      const key = k.tagName + '.' + cls(k);
      (groups.get(key) || groups.set(key, []).get(key)).push(k);
    }
    for (const [key, members] of groups) {
      if (members.length < 3) continue;
      const rects = members.map(m => m.getBoundingClientRect());
      // Ряд, а не столбик: каждый пункт перекрывается по вертикали с первым.
      if (!rects.every(r => r.top < rects[0].bottom - 1 && r.bottom > rects[0].top + 1)) continue;
      const ls = members.map(lines);
      const max = Math.max(...ls), min = Math.min(...ls);
      // Ловится только рваность: сосед в одну строку рядом с соседом в две и больше.
      // Ряд, где перенеслись все, — это выбранная высота, а не нехватка места.
      if (max < 2 || min !== 1) continue;
      const i = ls.indexOf(max);
      out.push({
        k: key.replace(/\.$/, ''), n: members.length, строки: ls,
        t: (members[i].textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28),
        w: Math.round(rects[i].width)
      });
    }
  }
  return out.slice(0, 6);
};

const P_MIMIC = () => {
  const rgb = v => (String(v).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const chromatic = v => { const c = rgb(v); return c.length === 3 && Math.max(...c) - Math.min(...c) >= 24; };
  const light = v => { const c = rgb(v); return c.length === 3 && Math.min(...c) >= 240; };
  const near = (el, sel) => { const f = el.closest('label, .field, li, div'); return f ? (f.innerText || '').trim().slice(0, 40) : sel; };
  const out = { mimic: [], handles: [], split: null };
  const toggles = [...document.querySelectorAll('input[type="checkbox"], input[type="radio"]')];
  const seen = [];
  for (const el of toggles) {
    const c = getComputedStyle(el);
    if (c.appearance !== 'none' && c.webkitAppearance !== 'none') continue;  // это разбирает проба 8
    const w = parseFloat(c.width), h = parseFloat(c.height), bw = parseFloat(c.borderTopWidth) || 0;
    const signs = [];
    if (bw >= 2) signs.push(`линия ${bw}px`);
    if (w && (w < 12 || w > 19)) signs.push(`размер ${Math.round(w)}px`);
    if (chromatic(c.borderTopColor)) signs.push('цветная линия');
    if (c.boxShadow && c.boxShadow !== 'none') signs.push('своя тень');
    if (!light(c.backgroundColor) && c.backgroundColor !== 'rgba(0, 0, 0, 0)') signs.push('своё поле');
    seen.push({ type: el.type, w: Math.round(w), h: Math.round(h), bw, color: c.borderTopColor });
    if (!signs.length)
      out.mimic.push({ el: `${el.type} «${near(el, el.type)}»`, geom: `${Math.round(w)}×${Math.round(h)}px, линия ${bw}px ${c.borderTopColor}, радиус ${c.borderTopLeftRadius}` });
  }
  const cb = seen.find(s => s.type === 'checkbox'), rd = seen.find(s => s.type === 'radio');
  if (cb && rd && (cb.color !== rd.color || cb.w !== rd.w || cb.bw !== rd.bw))
    out.split = `checkbox ${cb.w}px/${cb.bw}px/${cb.color} против radio ${rd.w}px/${rd.bw}px/${rd.color}`;
  for (const el of document.querySelectorAll('textarea')) {
    const c = getComputedStyle(el);
    if (c.resize && c.resize !== 'none') out.handles.push({ el: near(el, 'textarea'), resize: c.resize });
  }
  // Селект со снятым appearance держится на одном значке: он единственное, чем поле со
  // списком отличается от поля для ввода. Значок, нарисованный градиентами, легко выходит
  // тоньше пикселя — проценты в linear-gradient считаются от размера фона, и «50% → 56%»
  // на 7px даёт штрих 0.4px, который браузер размывает в еле заметную тень.
  out.arrows = [];
  for (const el of document.querySelectorAll('select')) {
    const c = getComputedStyle(el);
    if (c.appearance !== 'none' && c.webkitAppearance !== 'none') continue;  // системная стрелка — проба 8
    const img = c.backgroundImage || 'none';
    if (img === 'none') { out.arrows.push({ el: near(el, 'select'), why: 'системный вид снят, а своего значка списка нет вовсе' }); continue; }
    const sizes = (c.backgroundSize || '').split(',').map(v => parseFloat(v) || 0);
    const layers = img.split(/,(?![^()]*\))/);
    let thinnest = Infinity, box = 0;
    layers.forEach((L, i) => {
      if (!/gradient/.test(L)) return;
      const pct = [...new Set((L.match(/(\d+(?:\.\d+)?)%/g) || []).map(parseFloat))].sort((a, b) => a - b);
      const px = sizes[i] || sizes[0] || 0;
      box = Math.max(box, px);
      if (pct.length >= 2 && px) thinnest = Math.min(thinnest, (pct[pct.length - 1] - pct[0]) / 100 * px);
    });
    if (box && box < 9) out.arrows.push({ el: near(el, 'select'), why: `значок списка ${Math.round(box)}px — мельче строчной буквы рядом` });
    else if (thinnest !== Infinity && thinnest < 1.5) out.arrows.push({ el: near(el, 'select'), why: `штрих значка ${thinnest.toFixed(1)}px — тоньше пикселя, браузер размывает его в тень` });
  }
  return out;
};

// --- 8. контролы, оставленные браузеру
say('── 8. ДЕФОЛТНЫЕ КОНТРОЛЫ ───────────────────────────');
{
  const { items, stub, blocked } = await page.evaluate(P_DEFAULTS);
  if (blocked) note('контрол', `эталон в iframe не снялся (${blocked}) — проба 8 не работала`);
  for (const t of stub) {
    fail('форма', `текст-заглушка в форме: «${t}»`);
    say(`  ✗ «${t}» — стоит там, где просят контакты, и стирает доверие ровно в этом месте`);
  }
  if (!items.length) say('  контролов на странице нет');
  const byFont = {};
  for (const c of items) {
    const bad = [];
    if (c.untouched) bad.push('не оформлен вовсе: все замеряемые свойства равны браузерному дефолту');
    if (c.sysFont) bad.push('системный шрифт вместо шрифта страницы');
    if (c.sysWidget && ['SELECT'].includes(c.tag)) bad.push('системная стрелка (appearance не снят)');
    if (c.sysWidget && ['checkbox', 'radio'].includes(c.type) && c.sysAccent)
      bad.push('системный вид и accent-color по умолчанию — цвет ОС мимо палитры');
    if (c.tag === 'FIELDSET' && !c.diff.includes('borderTopStyle') && !c.diff.includes('borderTopColor'))
      bad.push('дефолтная рамка fieldset');
    if (c.otherFont) (byFont[c.font] ||= []).push(c.el);
    if (bad.length) {
      fail('контрол', `${c.el}: ${bad.join(', ')}`);
      say(`  ✗ ${c.el} — ${bad.join('; ')}`);
    }
  }
  // Один вопрос на семейство, а не на каждую кнопку: четыре одинаковых строки про один и тот же
  // шрифт — это не четыре находки, а одно решение, принятое один раз.
  for (const [font, els] of Object.entries(byFont))
    note('контрол', `шрифт «${font}» стоит только на контролах (${els.length}: ${els.slice(0, 4).join(', ')}${els.length > 4 ? ', …' : ''}) и не встречается в тексте страницы — назови причину или возьми шрифт страницы`);
  const okC = !fails.some(f => f.area === 'контрол');
  if (items.length && okC) say(`  ${items.length} контролов, каждый отличается от голого дефолта`);
}

// --- 9. общая линия в сетке
say('── 9. ОБЩАЯ ЛИНИЯ В СЕТКЕ ──────────────────────────');
{
  let seenG = 0;
  for (const w of [1440, 1024]) {
    const p4 = await browser.newPage({ viewport: { width: w, height: 900 } });
    await p4.goto(url, { waitUntil: 'networkidle' });
    await p4.waitForTimeout(120);
    const rows = await p4.evaluate(P_GRID);
    for (const r of rows) {
      seenG++;
      fail('сетка', `${w}px: ${r.n}× ${r.group} — нижняя строка (${r.row}, «${r.text}») ни на одной общей линии: ${r.edge} расходится на ${r.gaps.join('/')}px, разброс ${r.spread}px`);
      say(`  ✗ ${w}px ${r.n}× ${r.group}: «${r.text}» прижата к своему абзацу, а не к общей линии (${r.edge}: ${r.gaps.join('/')}px)`);
    }
    await p4.close();
  }
  if (!seenG) say('  карточки одной высоты держат нижнюю строку на общей линии');
}

// --- 10. разнобой в оформлении соседей одной роли
say('── 10. РАЗНОБОЙ У СОСЕДЕЙ ──────────────────────────');
{
  let seenS = 0;
  for (const w of [1440, 1024]) {
    const p5 = await browser.newPage({ viewport: { width: w, height: 900 } });
    await p5.goto(url, { waitUntil: 'networkidle' });
    await p5.waitForTimeout(120);
    const rows = await p5.evaluate(P_STYLE);
    for (const r of rows) {
      seenS++;
      fail('разнобой', `${w}px: ${r.n}× ${r.group} → ${r.part}: один оформлен иначе остальных — ${r.what}`);
      say(`  ✗ ${w}px ${r.n}× ${r.group} → ${r.part}: ${r.what}`);
    }
    await p5.close();
  }
  if (!seenS) say('  соседи одной роли нарисованы одним языком');
}

// --- 11. иерархия, пропадающая на узкой ширине
say('── 11. РАНГ НА УЗКОЙ ШИРИНЕ ────────────────────────');
{
  const snap = {};
  for (const w of [1440, 390]) {
    const p6 = await browser.newPage({ viewport: { width: w, height: 900 } });
    await p6.goto(url, { waitUntil: 'networkidle' });
    await p6.waitForTimeout(120);
    snap[w] = await p6.evaluate(P_RANK);
    await p6.close();
  }
  const ratio = a => Math.max(...a) / Math.min(...a);
  let seenR = 0;
  for (const [id, wide] of Object.entries(snap[1440])) {
    const narrow = snap[390][id];
    if (!narrow || narrow.length !== wide.length) continue;
    if (Math.min(...wide) <= 0 || Math.min(...narrow) <= 0) continue;
    const rw = ratio(wide), rn = ratio(narrow);
    // Ранг на широкой заявлен внятно (от 1.25). На узкой он считается схлопнувшимся, если потерял
    // больше половины: 1.4× превратилось в 1.19× — старший всё ещё крупнее, но уже не старше.
    // Нижняя граница 1.12 нужна для слабо заявленного ранга, где половина — это ещё почти всё;
    // верхняя 1.25 — потому что различие крупнее четверти читается как ранг само по себе.
    const floor = Math.min(1.25, Math.max(1.12, 1 + (rw - 1) * 0.5));
    if (rw < 1.25 || rn > floor) continue;
    seenR++;
    fail('ранг', `${id}: различие ${rw.toFixed(2)}× на 1440 (${wide.join('/')}) против ${rn.toFixed(2)}× на 390 (${narrow.join('/')}) — ранг виден только на широком экране`);
    say(`  ✗ ${id}: ${rw.toFixed(2)}× → ${rn.toFixed(2)}× (${wide.join('/')} → ${narrow.join('/')})`);
  }
  if (!seenR) say('  ранг соседей одинаково читается и на 1440, и на 390');
}

say('── 12. КРАЙ КОНТРОЛА ───────────────────────────────');
{
  const p7 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p7.goto(url, { waitUntil: 'networkidle' });
  await p7.waitForTimeout(120);
  const edges = await p7.evaluate(P_EDGE);
  await p7.close();
  for (const e of edges) {
    if (e.kind === 'призрак') {
      fail('край', `${e.el}: ${e.ghosts.join(', ')} — линия нарисована, но ниже 3:1 и не читается как край; сильнее неё ${e.best}:1, значит контрол опознаётся не ею`);
      say(`  ✗ ${e.el} — призрачный контур: ${e.ghosts.join(', ')}`);
    } else {
      fail('край', `${e.el}: сильнейший признак края ${e.best}:1 при требуемых 3:1 (WCAG 1.4.11) — контрол не отделён от фона`);
      say(`  ✗ ${e.el} — край ${e.best}:1 при 3:1`);
    }
  }
  if (!edges.length) say('  край каждого контрола отделён от фона либо тенью, которая не меряется');
}

say('── 13. РИТМ ВНУТРИ БЛОКА ───────────────────────────');
{
  const p8 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p8.goto(url, { waitUntil: 'networkidle' });
  await p8.waitForTimeout(120);
  const gaps = await p8.evaluate(P_GAP);
  await p8.close();
  for (const g of gaps) {
    fail('ритм', `${g.группа}: зазор ${g.пара} у соседей одной роли ${g.зазоры.join('/')}px — одна и та же по смыслу связь нарисована с разной силой`);
    say(`  ✗ ${g.группа} — ${g.пара}: ${g.зазоры.join('/')}px`);
  }
  if (!gaps.length) say('  одинаковые блоки держат один ритм внутри себя');
}

say('── 14. ЗАЧИН ВНУТРИ ГРУППЫ ─────────────────────────');
{
  const p9 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p9.goto(url, { waitUntil: 'networkidle' });
  await p9.waitForTimeout(120);
  const leads = await p9.evaluate(P_LEAD);
  await p9.close();
  for (const g of leads) {
    fail('зачин', `${g.группа}: выделенный зачин («${g.пример}») есть у ${g.есть} из ${g.из} элементов одной роли — унификация брошена на середине`);
    say(`  ✗ ${g.группа} — ${g.часть}: ${g.есть}/${g.из}`);
  }
  if (!leads.length) say('  элементы одной роли устроены внутри одинаково');
}

say('── 15. МИШЕНЬ ПАЛЬЦА (390) ─────────────────────────');
{
  const p10 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p10.goto(url, { waitUntil: 'networkidle' });
  await p10.waitForTimeout(120);
  const taps = await p10.evaluate(P_TAP);
  await p10.close();
  for (const t of taps) {
    const m = `${t.что} «${t.текст}» — мишень ${t.w}×${t.h}px при 44×44`;
    if (t.тесно) { fail('мишень', m + ': по такой на телефоне промахиваются в соседнюю'); say(`  ✗ ${m}`); }
    else { note('мишень', m + ': чуть мало — либо добрать падингом, либо объяснить, почему здесь хватает'); say(`  ? ${m}`); }
  }
  if (!taps.length) say('  каждая мишень на 390 не меньше пальца');
}

say('── 16. ЧЕРТА ВДОЛЬ ПУСТОТЫ ─────────────────────────');
{
  const p11 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p11.goto(url, { waitUntil: 'networkidle' });
  await p11.waitForTimeout(120);
  const rules = await p11.evaluate(P_RULE);
  await p11.close();
  for (const r of rules) {
    const m = `${r.что} «${r.текст}» — линия ${r.сторона} ${r.длина}px, из них ${r.пусто}px пустоты ${r.где}`;
    const hint = ': черта отбивает и пустой отрезок тоже — либо высота по содержимому, либо черта сверху во всю ширину';
    // Пустота больше половины черты и длиннее 160px — это уже не хвост воздуха, а
    // рамка вокруг ничего: глаз читает её как ошибку вёрстки, а не как приём.
    if (r.пусто >= 160 && r.пусто >= r.длина * 0.5) { fail('черта', m + hint); say(`  ✗ ${m}`); }
    else { note('черта', m + hint); say(`  ? ${m}`); }
  }
  if (!rules.length) say('  ни одна черта не идёт вдоль пустоты');
}

say('── 17. ПРИЗРАЧНАЯ ЗАЛИВКА ──────────────────────────');
{
  const p12 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p12.goto(url, { waitUntil: 'networkidle' });
  await p12.waitForTimeout(120);
  const ghosts = await p12.evaluate(P_GHOST);
  await p12.close();
  for (const g of ghosts) {
    const m = `${g.n} полей с заливкой ${g.k}:1 к подложке при площадях ${g.sSmall}px² (${g.малый}) … ${g.sBig}px² (${g.большой}), разброс ×${g.разброс}`;
    fail('заливка', m + ': ниже 1.2:1 заливки нет — она включается площадью, и один CSS даёт два типа поля; либо убрать её совсем, либо дать опору, не зависящую от площади');
    say(`  ✗ ${m}`);
  }
  if (!ghosts.length) say('  ни одна заливка не держится на площади');
}

say('── 18. РАСКРЫВАШКА МЕЛЬЧЕ ТЕКСТА ───────────────────');
{
  const p13 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p13.goto(url, { waitUntil: 'networkidle' });
  await p13.waitForTimeout(120);
  const minors = await p13.evaluate(P_MINOR);
  await p13.close();
  for (const g of minors) {
    const m = `${g.n} из ${g.всего} раскрывашек набраны ${g.кегль}px при основном тексте ${g.текст}px — «${g.что}»`;
    fail('раскрывашка', m + ': заголовок своего блока не может быть мельче абзаца — ряд таких строк читается как список микроподписей и глаз проскальзывает секцию');
    say(`  ✗ ${m}`);
  }
  if (!minors.length) say('  каждая раскрывашка крупнее основного текста');
}

say('── 19. РЫБА В ГОТОВОЙ СТРАНИЦЕ ──────────────────────');
{
  const p14 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p14.goto(url, { waitUntil: 'networkidle' });
  await p14.waitForTimeout(120);
  const lorem = await p14.evaluate(P_LOREM);
  await p14.close();
  for (const g of lorem) {
    const m = `${g.род}: «${g.что}» (${g.где})`;
    fail('рыба', m + ' — заглушка стоит там, где посетитель проверяет, живые ли за страницей люди: одна такая строка обнуляет доверие, набранное всем остальным');
    say(`  ✗ ${m}`);
  }
  if (!lorem.length) say('  заглушек и рыбы не осталось');
}

say('── 20. ШАПКА СЪЕДАЕТ ПЕРВЫЙ ЭКРАН (390) ────────────');
{
  const p15 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await p15.goto(url, { waitUntil: 'networkidle' });
  await p15.waitForTimeout(150);
  const fold = await p15.evaluate(P_FOLD);
  await p15.close();
  for (const g of fold) {
    const m = `шапка и меню занимают ${g.высота}px из ${g.экран} (${g.доля}%) — заголовок «${g.что}» начинается только на ${g.верхH1}px`;
    fail('первый экран', m + ': меню — вход в содержание, а не содержание; посетитель за свои две секунды видит оглавление вместо предложения. Свернуть список в одну строку-кнопку на узкой ширине');
    say(`  ✗ ${m}`);
  }
  if (!fold.length) say('  первый экран на 390 занят содержанием, а не меню');
}

say('── 21. КОНТРОЛ ПРИТВОРЯЕТСЯ ДЕФОЛТНЫМ ──────────────');
{
  // Свежая вкладка обязательна: к этому месту прогона проба формы уже нажимала submit,
  // и незаполненные обязательные поля стоят в :invalid — красная обводка чекбокса тогда
  // читается как разнобой оформления, которого в покое нет.
  const p16 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p16.goto(url, { waitUntil: 'networkidle' });
  await p16.waitForTimeout(150);
  const m = await p16.evaluate(P_MIMIC);
  await p16.close();
  for (const c of m.mimic) {
    fail('мимикрия', `${c.el}: снят системный вид, но в пустом состоянии нарисован ровно как системный (${c.geom}) — ни одного признака руки: линия тоньше 2px, размер в дефолтном диапазоне, цвет серый, ни тени, ни своего поля. Отмена дефолта не засчитывается как оформление: глаз сравнивает не со стилями браузера, а с картинкой, которую он помнит`);
    say(`  ✗ ${c.el} — ${c.geom}: это описание дефолта`);
  }
  for (const h of m.handles) {
    fail('мимикрия', `textarea «${h.el}»: resize: ${h.resize} — браузер рисует в углу свою ручку (три диагональные риски в системной серой гамме), перекрасить её нельзя. Либо resize: none + field-sizing: content, либо поле остаётся с чужой деталью`);
    say(`  ✗ textarea «${h.el}» — видимая ручка resize в чужой гамме`);
  }
  for (const a of m.arrows || []) {
    fail('мимикрия', `select «${a.el}»: ${a.why}. Поле со списком отличается от поля для ввода одним этим значком; неразличимый значок означает, что посетитель не знает, что здесь выбор, пока не ткнёт`);
    say(`  ✗ select «${a.el}» — ${a.why}`);
  }
  if (m.split) note('контрол', `переключатели одной формы оформлены по-разному: ${m.split} — различать их должна форма, а не толщина и цвет линии`);
  if (!m.mimic.length && !m.handles.length && !(m.arrows || []).length) say('  переключатели и поля несут признак руки, системных деталей не осталось');
}

say('── 22. ПОДПИСЬ ВЫПАЛА ИЗ КОЛОНКИ ───────────────────');
  {
    const rows = await page.evaluate(P_ROWEDGE);
    for (const r of rows) {
      fail('колонка', `подпись «${r.t}» начинается на ${r.left}px, тогда как остальные подписи этой формы стоят на ${r.base}px — разъезд ${r.d}px. Такой сдвиг мал для второй колонки и велик для незаметного: глаз читает его как выпавшую строку, а не как акцент. Обычно виноват декор — рамка fieldset, полоска слева, иконка перед словом: они добавляют свой отступ внутрь. Декор выносится на поля отрицательным отступом ровно на свою ширину, содержимое остаётся на общем крае`);
      say(`  ✗ «${r.t}» — ${r.left}px против ${r.base}px, разъезд ${r.d}px`);
    }
    if (!rows.length) say('  подписи формы начинаются с одной вертикали');
  }

  say('── 23. ПОДПИСЬ ВЫПАЛА ИЗ РЯДА ПО ВЕСУ ──────────────');
  {
    const rows = await page.evaluate(P_WSTEP);
    for (const r of rows) {
      fail('ряд', `«${r.t}» набрана весом ${r.w}, тогда как остальные ${r.n - 1} подписей того же ряда (${r.k}) стоят на ${r.base} — ровно одна ступень разницы. Для другого ранга ступени мало: глаз не читает «здесь другое», он читает недоделанную строку. Если строка особая — итог, надбавка, сноска, — её отдельность держат линия, место в подвале или отступ, а вес возвращается к общему`);
      say(`  ✗ «${r.t}» — вес ${r.w} против ${r.base} у остальных ${r.n - 1}`);
    }
    if (!rows.length) say('  подписи каждого ряда набраны одним весом');
  }

  say('── 24. КНОПКИ В СТОЛБИКЕ РАЗНОЙ ШИРИНЫ ───────');
  {
    // Строка становится столбиком на узком экране — там же вылезает и разбег ширин.
    // Смотрим обе ширины: столбик бывает и на широкой (сайдбар, модальное окно, форма).
    const rows = [];
    for (const vw of [1440, 390]) {
      const ps = await browser.newPage({ viewport: { width: vw, height: vw === 390 ? 844 : 900 } });
      await ps.goto(url, { waitUntil: 'networkidle' });
      await ps.waitForTimeout(150);
      for (const r of await ps.evaluate(P_STACK)) {
        if (!rows.some(q => q.k === r.k && q.n === r.n)) rows.push({ ...r, vw });
      }
      await ps.close();
    }
    for (const r of rows) {
      fail('столбик', `«${r.t}» и соседи (${r.k}, ${r.n} шт.) стоят один под другим на общем левом крае (окно ${r.vw}px), а ширины у них разные: ${r.ws.join(' / ')}px, разбег ${r.span}px. В строке ширина по подписи естественна, в столбике она даёт разъехавшийся правый край — для замысла разницы мало, для незаметности много. Ширину задаёт колонка, а иерархию — заливка против обводки`);
      say(`  ✗ «${r.t}» @${r.vw} — ${r.ws.join(' / ')}px, разбег ${r.span}px`);
    }
    if (!rows.length) say('  плашки в столбике держат общий правый край');
  }

  say('── 25. РАЗРЯДЫ В ЧИСЛЕ РАЗОРВАНЫ ───────');
  {
    // Ширину задаём явно: предыдущие разделы оставляют окно узким, а на узком число
    // переносится по разделителю разрядов, пробел в конце строки схлопывается в нуль —
    // и дыра, отчётливо видимая на макете, пробе не показывается вовсе.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(80);
    const rows = await page.evaluate(P_DIGIT);
    for (const r of rows) {
      fail('разряды', `«${r.t}» (${r.k}, ${r.fs}px): разделитель разрядов шириной ${r.sp}px при цифре ${r.dg}px — ${r.ratio}em, тогда как цифра ${r.dg}px. Группу разрядов отделяет тонкая шпация, 0.16–0.33em, иначе число распадается на два. В моноширинном шрифте подмена символа не помогает — все пробельные занимают одно знакоместо; сужает только word-spacing`);
      say(`  ✗ «${r.t}» ${r.fs}px — дыра ${r.sp}px = ${r.ratio}em`);
    }
    if (!rows.length) say('  разделитель разрядов не шире тонкой шпации');
  }

  say('── 26. ЯКОРЬ УЕЗЖАЕТ ПОД ЛИПКУЮ ШАПКУ ───');
  {
    // Шапка на узком окне выше — строка меню переносится, — поэтому смотрим обе ширины:
    // страница, чистая на 1280, на 390 прячет заголовок раздела под двойную шапку.
    const seenA = new Set();
    const rows = [];
    for (const w of [1280, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(80);
      for (const r of await page.evaluate(P_ANCHOR)) {
        if (seenA.has(r.id)) continue;
        seenA.add(r.id);
        rows.push({ ...r, w });
      }
    }
    for (const r of rows) {
      fail('якорь', `при окне ${r.w}px переход на «#${r.id}» ставит цель под липкую шапку: ${r.hidden}px верха раздела закрыто шапкой высотой ${r.hdr}px (scroll-margin-top у цели ${r.sm}px). После клика по меню посетитель видит не начало раздела, а его середину. Лечит поле прокрутки у корня: html { scroll-padding-top: <высота шапки> } — оно работает и для клика, и для ссылки снаружи, и для навигации с клавиатуры`);
      say(`  ✗ #${r.id} — под шапкой ${r.hidden}px`);
    }
    if (!rows.length) say('  переходы по якорям встают ниже липкой шапки');
  }

  say('── 27. ЗНАК ВАЛЮТЫ СЛИПСЯ С ЧИСЛОМ ─────');
  {
    const rows = await page.evaluate(P_CUR);
    for (const r of rows) {
      fail('валюта', `«${r.t}» (${r.k}, ${r.fs}px): просвет перед знаком валюты ${r.sp}px — ${r.ratio}em при обычных 0.2–0.3em, word-spacing здесь ${r.ws}${r.from ? ', унаследован от ' + r.from : ''}. Пробел в разметке стоит, значит просвет задуман, — его съел CSS. Сужение пробела наследуется потомками в вычисленных пикселях, а не в em: -0.35em, уместные на мелкой моноширинной строке, приходят в крупную цифру абсолютным числом и схлопывают просвет перед знаком. Правило ставится на сам элемент с числом, а потомкам с другим шрифтом возвращается word-spacing: normal`);
      say(`  ✗ «${r.t}» ${r.fs}px — просвет ${r.sp}px = ${r.ratio}em`);
    }
    if (!rows.length) say('  знак валюты отделён от числа');
  }

  say('── 28. КРУГ НЕ КРУГЛЫЙ ────────────');
  {
    const rows = await page.evaluate(P_ROUND);
    for (const r of rows) {
      fail('круг', `«${r.t}» (${r.k}): border-radius в процентах заявляет круг, а элемент ${r.w}×${r.h} — овал, скос ${r.skew}%. Диаметр не задан (width/height ${r.sized === 'да' ? 'есть, но разные' : 'нет'}), размер отдан содержимому через padding — и border-radius:50% рисует эллипс по коробке текста. В ряду таких значков «1» и «10» получают разный размер без всякой иерархии. Лечение: задать диаметр явно (width = height) и центрировать содержимое внутри, а не набирать круг отступами`);
      say(`  ✗ «${r.t}» ${r.w}×${r.h}, скос ${r.skew}%`);
    }
    if (!rows.length) say('  круглые значки круглые');
  }

  say('── 29. ИЕРАРХИЯ СХЛОПЫВАЕТСЯ НА УЗКОМ ────────────');
  {
    // Кегли сравниваются у ТЕХ ЖЕ элементов на двух ширинах, поэтому первый проход
    // метит их data-атрибутом: атрибут переживает смену вьюпорта, а ссылка на узел — нет.
    const ph = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await ph.goto(url, { waitUntil: 'networkidle' });
    await ph.waitForTimeout(150);
    const wide = await ph.evaluate(P_HIER_MARK);
    await ph.setViewportSize({ width: 390, height: 844 });
    await ph.waitForTimeout(150);
    const rows = wide.length ? await ph.evaluate(P_HIER_CHECK, wide) : [];
    await ph.close();
    for (const r of rows) {
      fail('иерархия', `«${r.h}» — заголовок раздела, «${r.k}» — заголовок внутри него. На 1440 разница читается (${r.wideH}/${r.wideK} = ${r.rW}×), на 390 схлопывается до ${r.nH}/${r.nK} = ${r.rN}×: раздел перестаёт отличаться от карточки, и страница на телефоне превращается в один непрерывный список. Адаптив односторонний — clamp() стоит на верхнем уровне, а нижний задан фиксированным rem и не сжимается вместе с ним. Лечение: масштабировать весь ряд заголовков, а не только верхний, и держать нижнюю границу верхнего уровня выше нижнего`);
      say(`  ✗ «${r.h}»/«${r.k}» ${r.rW}×→${r.rN}× (${r.wideH}/${r.wideK} → ${r.nH}/${r.nK})`);
    }
    if (!rows.length) say('  иерархия заголовков держится и на узком экране');
  }

  say('── 30. ПУСТОЕ ПОЛЕ БЕЗ ПРИЗНАКОВ ────────────');
  {
    const pf = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pf.goto(url, { waitUntil: 'networkidle' });
    await pf.waitForTimeout(120);
    const hollow = await pf.evaluate(P_HOLLOW);
    await pf.close();
    for (const g of hollow) {
      const m = `поле «${g.t}» ${g.w}×${g.h}px: заливка ${g.fill}, рамка — ${g.sides}, примера ввода нет`;
      fail('поле', m + ': до первого клика площадь поля ничем не занята, и строка читается как подпись с линейкой, а не как место, куда пишут. Форма выглядит формой только после того, как в неё начали печатать. Опора нужна хотя бы одна: различимая заливка, контур из трёх сторон, или placeholder с примером ввода — он занимает площадь и сразу показывает, чего от посетителя ждут');
      say(`  ✗ ${m}`);
    }
    if (!hollow.length) say('  каждое пустое поле видно как поле');
  }

  say('── 31. ССЫЛКА НЕОТЛИЧИМА ОТ ТЕКСТА ──────────');
  {
    const pl = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pl.goto(url, { waitUntil: 'networkidle' });
    await pl.waitForTimeout(120);
    const links = await pl.evaluate(P_LINK);
    await pl.close();
    for (const g of links) {
      const m = `ссылка «${g.t}» в абзаце: от соседнего текста её отличает только цвет, контраст ${g.k}:1`;
      fail('ссылка', m + ': ни подчёркивания, ни веса, ни фона — прочитать её как ссылку нельзя, пока не наведёшь курсор, а на телефоне курсора нет вовсе. Цвет — самый слабый из признаков: он теряется на плохом экране и при дальтонизме. Нужен второй признак, видимый без наведения: подчёркивание, собственный вес или подложка');
      say(`  ✗ ${m}`);
    }
    if (!links.length) say('  ссылки в тексте видны как ссылки');
  }

  say('── 32. ОБРЕЗАННЫЙ ТЕКСТ, КОТОРЫЙ НЕГДЕ ДОЧИТАТЬ ──');
  {
    const pc = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pc.goto(url, { waitUntil: 'networkidle' });
    await pc.waitForTimeout(120);
    const cuts = await pc.evaluate(P_CLIP);
    await pc.close();
    for (const c of cuts) {
      const m = `«${c.t}» обрезан (${c.how}), спрятано ${c.hid}px`;
      fail('обрезка', m + ': многоточие обещает продолжение, но дочитать его негде — ни подсказки с полным текстом, ни ссылки, ни «показать целиком». Посетитель видит, что от него что-то скрыли, и не может это открыть; на телефоне нет даже наведения. Либо дать полный текст (title или раскрытие), либо укоротить его так, чтобы обрезка не понадобилась');
      say(`  ✗ ${m}`);
    }
    if (!cuts.length) say('  обрезанного текста без доступа к полному нет');
  }

  say('── 33. ПУНКТ РЯДА ПЕРЕНОСИТСЯ, СОСЕД — НЕТ ──────');
  {
    // Ряд разваливается не на краю диапазона, а посередине: на 1440 он ещё цел, на 390 уже
    // честно стал столбиком, а рвётся между ними — ровно там, куда никто не смотрит. Поэтому
    // проходим промежуточные ширины и запоминаем худшую для каждой группы.
    const seen = new Map();
    for (const vw of [1280, 1024, 900, 768, 600, 480]) {
      const pw = await browser.newPage({ viewport: { width: vw, height: 900 } });
      await pw.goto(url, { waitUntil: 'networkidle' });
      await pw.waitForTimeout(140);
      for (const r of await pw.evaluate(P_WRAP)) {
        const prev = seen.get(r.k);
        if (!prev || Math.max(...r.строки) > Math.max(...prev.строки)) seen.set(r.k, { ...r, vw });
      }
      await pw.close();
    }
    for (const r of seen.values()) {
      fail('перенос', `«${r.t}» в ряду ${r.k} (${r.n} шт., окно ${r.vw}px) переносится на ${Math.max(...r.строки)} строки при ширине ${r.w}px, тогда как соседи по ряду стоят в одну: строки ${r.строки.join('/')}. Переполнения нет, и механически ряд цел — но ровный ряд коротких подписей держится именно тем, что каждая подпись в одну строку. Рваная высота читается не как решение, а как «места не хватило». Либо ряд переводится в столбик раньше, либо подписи короче, либо пунктам задаётся общая высота и запрет переноса`);
      say(`  ✗ «${r.t}» @${r.vw} — строки ${r.строки.join('/')}`);
    }
    if (!seen.size) say('  ряды коротких подписей нигде не разъезжаются по высоте');
  }

// Пробы 34–39 меряют не отдельный дефект, а систему целиком: чем набрана страница, как она
// движется, из чего сложена, что делает под курсором, как ведёт себя в первые миллисекунды и
// что от неё остаётся при зуме. Ни одну из этих вещей не видно на снимке в покое — а именно они
// отличают собранную работу от собранной наспех.

// --- 34. инвентарь системы
// Дешевизна арифметична. У дорогой страницы пять кеглей, четыре шага отступов, два радиуса,
// три веса и один акцент; у дешёвой — девятнадцать кеглей и отступы 12/14/19/23. Считаем не
// «красиво ли», а сколько разных значений набралось: число не спорит.
const P_INVENTORY = () => {
  const R = window.__qaRoot ? window.__qaRoot() : document.body;
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const fs = new Map(), fw = new Map(), rad = new Map(), sh = new Map(), col = new Map(), step = new Map();
  for (const el of R.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.06) continue;
    // Кегль, вес и цвет засчитываем только там, где у элемента есть собственный текстовый узел:
    // иначе одна обёртка вокруг абзаца удваивает каждое значение и весь счёт теряет смысл.
    if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1)) {
      bump(fs, Math.round(parseFloat(cs.fontSize) * 2) / 2);
      bump(fw, cs.fontWeight);
      bump(col, cs.color);
    }
    for (const v of new Set(['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']
      .map(k => cs[k]).filter(v => v && v !== '0px' && !v.includes('%')))) bump(rad, v);
    // Цвет из тени вычищаем: одна и та же тень, перекрашенная под фон, — это одна тень.
    if (cs.boxShadow && cs.boxShadow !== 'none') bump(sh, cs.boxShadow.replace(/rgba?\([^)]*\)/g, 'C').trim());
    for (const k of ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'rowGap', 'columnGap']) {
      const v = parseFloat(cs[k]);
      if (Number.isFinite(v) && v >= 4) bump(step, Math.round(v));
    }
  }
  const out = [];
  // Порог по количеству намеренно щадящий: он ловит не «многовато», а «системы нет вовсе».
  const счёт = (m, вид, порог, ед) => {
    const ks = [...m.keys()];
    if (ks.length > порог) out.push({ вид, n: ks.length, порог, примеры: ks.slice(0, 12).map(k => k + (ед || '')).join(', ') });
  };
  счёт(fs, 'кеглей', 12, 'px'); счёт(fw, 'весов шрифта', 4, ''); счёт(rad, 'радиусов', 4, '');
  счёт(sh, 'теней', 4, ''); счёт(col, 'цветов текста', 8, ''); счёт(step, 'шагов отступов', 14, 'px');
  // Второй признак сильнее первого: две почти совпадающие величины — это не решение, а промах.
  // 15px и 16px рядом означают, что кегль не выбирали, а вводили заново каждый раз.
  const близкие = (m, вид, зазор, минимум) => {
    // Считаем только значения, встреченные хотя бы дважды: одиночный 15px посреди шкалы из
    // шестнадцатых — скорее исключение по делу, чем расползшаяся шкала.
    const ks = [...m.entries()].filter(([, c]) => c >= 2).map(([k]) => Number(k)).filter(Number.isFinite).sort((a, b) => a - b);
    const пары = [];
    for (let i = 1; i < ks.length; i++) {
      if (ks[i] >= минимум && ks[i] - ks[i - 1] <= зазор && ks[i] !== ks[i - 1]) пары.push(`${ks[i - 1]}/${ks[i]}`);
    }
    if (пары.length) out.push({ вид, близкие: пары.slice(0, 6).join(', ') });
  };
  близкие(fs, 'кегли', 1.5, 10);
  близкие(step, 'шаги отступов', 3, 8);
  return out;
};

say('── 34. ИНВЕНТАРЬ СИСТЕМЫ ───────────────────────────');
{
  const p34 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p34.goto(url, { waitUntil: 'networkidle' });
  await p34.waitForTimeout(140);
  const inv = await p34.evaluate(P_INVENTORY);
  await p34.close();
  for (const g of inv) {
    if (g.близкие) {
      const m = `${g.вид} различаются на глаз неразличимо: ${g.близкие}`;
      fail('инвентарь', `${m} — соседние значения, каждое использовано не по одному разу. Разница, которую не видно, не несёт смысла, но обязывает помнить лишнее число: это не шкала, а набор случайных вводов. Шкала строится шагом (например 1.25×) и записывается в токены, а не подбирается на месте`);
      say(`  ✗ ${m}`);
    } else {
      const m = `${g.вид}: ${g.n} при разумных ${g.порог} — ${g.примеры}`;
      fail('инвентарь', `${m}. Столько разных значений не выбирают, их накапливают: каждое новое ставилось на глаз, поверх предыдущего. Глаз читает это как отсутствие руки — не «богато», а «собрано из кусков». Свести к короткой шкале и вынести в переменные`);
      say(`  ✗ ${m}`);
    }
  }
  if (!inv.length) say('  шкалы короткие: кегли, отступы, радиусы и тени пересчитываются по пальцам');
}

// --- 35. движение
// Разнобой длительностей меряется той же арифметикой, что и разнобой отступов, и виден так же
// ясно: 0.2s рядом с 0.22s — не замысел, а два разных дня работы.
const P_MOTION_SET = () => {
  const R = window.__qaRoot ? window.__qaRoot() : document.body;
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const durs = new Map();
  const все = [], долгие = [], всеСвойства = [];
  const раскладка = [], reveal = [];
  const LAYOUT = /^(width|height|top|left|right|bottom|margin|padding|inset|min-|max-)/;
  const имя = el => el.tagName + (el.id ? '#' + el.id : '') + (el.classList[0] ? '.' + el.classList[0] : '');
  for (const el of R.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) continue;
    const cs = getComputedStyle(el);
    const мс = v => v.trim().endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000;
    for (const v of (cs.transitionDuration || '').split(',')) {
      const t = мс(v);
      if (t > 0) { bump(durs, Math.round(t)); if (t > 700) долгие.push(`${имя(el)} ${Math.round(t)}мс`); }
    }
    for (const v of (cs.animationDuration || '').split(',')) {
      const t = мс(v);
      if (t > 0) bump(durs, Math.round(t));
    }
    // transition: all анимирует и то, что менять нельзя, — ширину, высоту, отступы. Раскладка
    // начинает «доезжать» на глазах у посетителя, и каждый такой доезд стоит кадров.
    if ((cs.transitionProperty || '').trim() === 'all' && parseFloat(cs.transitionDuration) > 0) всеСвойства.push(имя(el));
    const props = (cs.transitionProperty || '').split(',').map(s => s.trim());
    if (parseFloat(cs.transitionDuration) > 0 && props.some(p => LAYOUT.test(p))) раскладка.push(`${имя(el)} transition:${props.filter(p => LAYOUT.test(p)).join('/')}`);
  }
  // @keyframes, меняющие раскладку, и reveal без страховки — из правил, не из computed
  const кадры = [];
  let guard = false;
  for (const лист of document.styleSheets) {
    let правила; try { правила = лист.cssRules; } catch { continue; }
    for (const r of правила) {
      if (r.type === CSSRule.KEYFRAMES_RULE) {
        for (const k of r.cssRules) for (const p of k.style) if (LAYOUT.test(p)) { кадры.push(`@keyframes ${r.name}: ${p}`); break; }
      }
      if (r.selectorText && /\.reveal|\[data-reveal/.test(r.selectorText) && r.style && r.style.opacity === '0') reveal.push(r.selectorText);
      if (r.selectorText && /no-js|:not\(\.js\)/.test(r.selectorText)) guard = true;
      if (r.type === CSSRule.MEDIA_RULE && /reduce/.test(r.conditionText || '')) for (const s of r.cssRules) if (s.selectorText && /\.reveal|\[data-reveal/.test(s.selectorText)) guard = true;
    }
  }
  const ks = [...durs.keys()].sort((a, b) => a - b);
  const близкие = [];
  for (let i = 1; i < ks.length; i++) if (ks[i] - ks[i - 1] <= 40) близкие.push(`${ks[i - 1]}/${ks[i]}мс`);
  return { всего: ks.length, значения: ks.slice(0, 12), близкие: близкие.slice(0, 6), долгие: [...new Set(долгие)].slice(0, 5), всеСвойства: [...new Set(всеСвойства)],
    раскладка: [...new Set([...раскладка, ...кадры])].slice(0, 6), revealБезСтраховки: guard ? [] : [...new Set(reveal)].slice(0, 4), всеДлительности: ks };
};

say('── 35. РАЗНОБОЙ ДВИЖЕНИЯ ───────────────────────────');
{
  const p35 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p35.goto(url, { waitUntil: 'networkidle' });
  await p35.waitForTimeout(140);
  const mo = await p35.evaluate(P_MOTION_SET);
  await p35.close();
  // Режим «кино»: значение, равное токену scene ±10 мс, — заявленная длительность хореографии
  // героя, а не забытая правка по месту, и «долгим» не считается.
  if (MOTION_SPEC && MOTION_SPEC.mode === 'кино' && MOTION_SPEC.tokens && MOTION_SPEC.tokens.scene) {
    const scene = MOTION_SPEC.tokens.scene;
    mo.долгие = mo.долгие.filter(s => {
      const t = Number((/([\d.]+)мс$/.exec(s) || [])[1]);
      return !(t && Math.abs(t - scene) <= 10);
    });
  }
  let чисто = true;
  if (mo.всего > 4) {
    чисто = false;
    const m = `${mo.всего} разных длительностей: ${mo.значения.join('/')}мс`;
    fail('движение', `${m}. Движение — такая же шкала, как кегли и отступы: у собранной работы их две-три (быстрая для наведения, средняя для раскрытия, медленная для входа секции). Столько значений означает, что каждое ставилось отдельно и ни одно не сравнивалось с соседним`);
    say(`  ✗ ${m}`);
  }
  if (mo.близкие.length) {
    чисто = false;
    const m = `неразличимо близкие длительности: ${mo.близкие.join(', ')}`;
    fail('движение', `${m} — разницу в 40 мс и меньше глаз не считывает как другую скорость, но она обязывает помнить два числа вместо одного. Свести к одному значению`);
    say(`  ✗ ${m}`);
  }
  if (mo.долгие.length) {
    чисто = false;
    const m = `переход длиннее 700 мс: ${mo.долгие.join(', ')}`;
    fail('движение', `${m}. Отклик на действие обязан уложиться в 100–300 мс: дольше — и посетитель успевает решить, что не нажалось, и нажимает второй раз. Длинные длительности уместны у входа секции при скролле, но не у того, что отвечает на клик`);
    say(`  ✗ ${m}`);
  }
  if (mo.всеСвойства.length >= 3) {
    чисто = false;
    const m = `transition: all у ${mo.всеСвойства.length} элементов (${mo.всеСвойства.slice(0, 4).join(', ')})`;
    fail('движение', `${m} — под «all» попадают и свойства раскладки: ширина, высота, отступы, положение. Любое их изменение начинает доезжать на глазах, страница «плывёт» вместо того, чтобы перестроиться, и каждый такой доезд считается браузером заново. Перечислять анимируемые свойства поимённо`);
    say(`  ✗ ${m}`);
  }
  if (mo.раскладка.length) {
    чисто = false;
    const m = `анимируется раскладка: ${mo.раскладка.slice(0, 4).join(', ')}`;
    fail('движение', `${m} — ширина, высота, отступы и положение пересчитывают раскладку на каждом кадре, и страница «плывёт». Анимируются только transform, opacity, filter; размер имитируется через scale внутри overflow:hidden, положение — через translate`);
    say(`  ✗ ${m}`);
  }
  if (mo.revealБезСтраховки.length) {
    чисто = false;
    const m = `reveal без страховки: ${mo.revealБезСтраховки.join(', ')}`;
    fail('движение', `${m} — opacity:0 до срабатывания скрипта: без JS, при ошибке в нём и под prefers-reduced-motion содержимое не появится никогда. Нужна страховка: правило html:not(.js) .reveal{opacity:1} или тот же сброс под @media (prefers-reduced-motion: reduce)`);
    say(`  ✗ ${m}`);
  }
  if (MOTION_SPEC && MOTION_SPEC.tokens && Object.keys(MOTION_SPEC.tokens).length) {
    const шкала = new Set(Object.values(MOTION_SPEC.tokens));
    const чужие = mo.всеДлительности.filter(d => !шкала.has(d));
    if (чужие.length) {
      чисто = false;
      const m = `длительности вне шкалы DESIGN.md (${[...шкала].join('/')}мс): ${чужие.join('/')}мс`;
      fail('движение', `${m} — в DESIGN.md объявлены токены micro/enter/scene, и любая длительность в коде обязана быть одним из них. Значение мимо шкалы — либо забытый токен, либо шкалу пора пересмотреть, но не молча`);
      say(`  ✗ ${m}`);
    }
  }
  // Правило режима «продукт» не зависит от того, распарсились ли токены длительности:
  // блок motion: без длительностей (или с micro/enter короче 800 мс) не должен глушить проверку.
  if (MOTION_SPEC && MOTION_SPEC.mode === 'продукт' && mo.всеДлительности.some(d => d >= 800)) {
    чисто = false;
    const m = `режим «продукт», а длительность ≥ 800 мс есть: ${mo.всеДлительности.filter(d => d >= 800).join('/')}мс`;
    fail('движение', `${m} — в продуктовом режиме токена scene нет: вход первого экрана — в пределах токена enter (300–600 мс), одним движением, скролл-кино запрещено (motion.md §1)`);
    say(`  ✗ ${m}`);
  }
  if (чисто) say(mo.всего ? `  движение сведено к ${mo.всего} длительностям: ${mo.значения.join('/')}мс` : '  движения на странице нет');
}

// --- 36. структура документа
// Проб на вид у нас три десятка, а на скелет — ни одной: страница может быть безупречной на
// картинке и при этом не иметь ни h1, ни main, ни alt. Для читающего экраном это не «мелочь
// оформления», а разница между содержанием и сплошным потоком.
const P_STRUCTURE = () => {
  const R = window.__qaRoot ? window.__qaRoot() : document.body;
  const ДОК = window.__qaBody ? window.__qaBody() : document.body;
  const узко = !!(window.__qaScope);
  const имя = el => el.tagName + (el.id ? '#' + el.id : '') + (el.classList[0] ? '.' + el.classList[0] : '');
  const видим = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const out = [];

  // Отсутствующий alt и пустой alt="" — разные вещи: второй означает «картинка декоративная,
  // не читай её», и это законный ответ. Ловим только полное отсутствие атрибута.
  const безAlt = [...R.querySelectorAll('img')].filter(i => видим(i) && !i.hasAttribute('alt') &&
    i.getAttribute('role') !== 'presentation' && i.getAttribute('aria-hidden') !== 'true');
  if (безAlt.length) out.push({ вид: 'alt', что: безAlt.slice(0, 5).map(имя).join(', '), n: безAlt.length });

  // Безымянные кнопки и ссылки: значок без подписи читается вслух как «ссылка» и всё.
  const немые = [...R.querySelectorAll('a[href], button, [role="button"]')].filter(el =>
    видим(el) && !(el.textContent || '').trim() && !el.getAttribute('aria-label') &&
    !el.getAttribute('aria-labelledby') && !el.getAttribute('title') &&
    ![...el.querySelectorAll('img[alt]')].some(i => (i.getAttribute('alt') || '').trim()));
  if (немые.length) out.push({ вид: 'имя', что: немые.slice(0, 5).map(имя).join(', '), n: немые.length });

  // Скелет документа — свойство страницы, а не секции: под --scope молчим, иначе каждая секция
  // будет отчитана за отсутствие собственного h1.
  if (!узко) {
    const hs = [...ДОК.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(видим);
    const h1 = hs.filter(h => h.tagName === 'H1');
    if (h1.length !== 1) out.push({ вид: 'h1', n: h1.length, что: h1.slice(0, 3).map(h => (h.textContent || '').trim().slice(0, 30)).join(' | ') });
    let пред = 0;
    for (const h of hs) {
      const ур = +h.tagName[1];
      if (пред && ур > пред + 1) { out.push({ вид: 'скачок', что: `h${пред} → h${ур} на «${(h.textContent || '').trim().slice(0, 34)}»` }); break; }
      пред = ур;
    }
    if (!ДОК.querySelector('main') && !ДОК.querySelector('[role="main"]')) out.push({ вид: 'main' });
  }
  return out;
};

say('── 36. СКЕЛЕТ ДОКУМЕНТА ────────────────────────────');
{
  const p36 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p36.goto(url, { waitUntil: 'networkidle' });
  await p36.waitForTimeout(140);
  const st = await p36.evaluate(P_STRUCTURE);
  await p36.close();
  const РАЗБОР = {
    alt: g => [`${g.n} видимых картинок без alt: ${g.что}`,
      'Атрибут alt отсутствует, а не пуст: это разные вещи. Пустой alt="" — сознательное «картинка декоративная, не читай»; отсутствующий заставляет экранный диктор зачитывать имя файла. Каждой картинке — либо описание, либо явное alt=""'],
    имя: g => [`${g.n} кнопок и ссылок без доступного имени: ${g.что}`,
      'Внутри только значок, подписи нет ни текстом, ни aria-label. Вслух такая кнопка звучит как «кнопка» — что она делает, узнать неоткуда. Значок остаётся, подпись добавляется скрытым текстом или aria-label'],
    h1: g => [g.n === 0 ? 'на странице нет ни одного видимого h1' : `видимых h1 на странице ${g.n}: ${g.что}`,
      'h1 — не «самый крупный текст», а название страницы, и оно одно. Ноль h1 означает, что страница не назвала себя; несколько — что название спорит само с собой. Крупность решается стилем, уровень — смыслом'],
    скачок: g => [`уровни заголовков идут через ступень: ${g.что}`,
      'Пропуск уровня читается как пропущенный раздел: тот, кто идёт по оглавлению, видит дыру в структуре. Уровень выбирается по вложенности, а размер — стилем; если h3 нужен ради кегля, кегль и надо задать, а уровень оставить честным'],
    main: () => ['на странице нет <main>',
      'Без него нельзя перепрыгнуть навигацию и попасть сразу к содержанию: читающий экраном каждый раз выслушивает всю шапку заново. Один тег вокруг основного содержимого закрывает вопрос'],
  };
  for (const g of st) {
    const [m, почему] = РАЗБОР[g.вид](g);
    fail('скелет', `${m}. ${почему}`);
    say(`  ✗ ${m}`);
  }
  if (!st.length) say('  один h1, уровни без скачков, main на месте, картинки подписаны');
}


// --- 37. состояния под курсором
// Снимок в покое — половина страницы. Вторая половина живёт в ответе на действие, и её не видно
// ни на одном скриншоте: кнопка, которая не отзывается на наведение, выглядит на картинке ровно
// так же, как отзывающаяся. Поэтому здесь мы не смотрим, а трогаем.
const P_HOVER_MARK = () => {
  const R = window.__qaRoot ? window.__qaRoot() : document.body;
  const имя = el => el.tagName + (el.id ? '#' + el.id : '') + (el.classList[0] ? '.' + el.classList[0] : '');
  const видим = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 8 && r.height > 8 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.06; };
  const снимок = el => { const cs = getComputedStyle(el); return {
    color: cs.color, bg: cs.backgroundColor, bgi: cs.backgroundImage, bc: cs.borderColor, bw: cs.borderWidth,
    sh: cs.boxShadow, tr: cs.transform, op: cs.opacity, td: cs.textDecorationLine, fl: cs.filter, oc: cs.outlineColor }; };
  const кандидаты = [];
  for (const el of R.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a[href]')) {
    if (!видим(el)) continue;
    const cs = getComputedStyle(el);
    // Ссылка внутри абзаца — не кнопка, и требовать от неё фона под курсором незачем. Кнопкоподобной
    // считаем ту, у которой есть собственная поверхность: фон, рамка или заметный внутренний отступ.
    if (el.tagName === 'A') {
      const свойФон = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      const рамка = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0;
      const отступ = parseFloat(cs.paddingLeft) >= 8 && parseFloat(cs.paddingTop) >= 6;
      if (!свойФон && !рамка && !отступ) continue;
    }
    const выключен = el.disabled === true || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled');
    кандидаты.push({ el, выключен, курсор: cs.cursor, снимок: снимок(el) });
  }
  const out = [];
  кандидаты.slice(0, 12).forEach((к, i) => {
    к.el.setAttribute('data-qa-hover', String(i));
    out.push({ i, имя: имя(к.el), выключен: к.выключен, курсор: к.курсор, до: к.снимок, текст: (к.el.textContent || '').trim().slice(0, 28) });
  });
  return out;
};
const P_HOVER_SNAP = (i) => {
  const R = window.__qaRoot ? window.__qaRoot() : document.body;
  const el = R.querySelector(`[data-qa-hover="${i}"]`);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { color: cs.color, bg: cs.backgroundColor, bgi: cs.backgroundImage, bc: cs.borderColor, bw: cs.borderWidth,
    sh: cs.boxShadow, tr: cs.transform, op: cs.opacity, td: cs.textDecorationLine, fl: cs.filter, oc: cs.outlineColor };
};

say('── 37. ОТВЕТ НА НАВЕДЕНИЕ ──────────────────────────');
{
  const ph = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await ph.goto(url, { waitUntil: 'networkidle' });
  await ph.waitForTimeout(160);
  const канд = await ph.evaluate(P_HOVER_MARK);
  const немые = [], безКурсора = [], выключенныеПохожи = [];
  for (const к of канд) {
    if (к.выключен) continue;
    try {
      await ph.hover(`[data-qa-hover="${к.i}"]`, { timeout: 1200 });
    } catch { continue; }
    await ph.waitForTimeout(220);
    const после = await ph.evaluate(P_HOVER_SNAP, к.i);
    if (!после) continue;
    const изменилось = Object.keys(после).some(k => после[k] !== к.до[k]);
    const подпись = `${к.имя}${к.текст ? ` «${к.текст}»` : ''}`;
    if (!изменилось) немые.push(подпись);
    // Курсор проверяем только у настоящих кнопок: у ссылки он pointer по умолчанию.
    if (к.курсор !== 'pointer' && к.имя.startsWith('BUTTON')) безКурсора.push(`${подпись} (cursor: ${к.курсор})`);
  }
  // Выключенная кнопка, неотличимая от рабочей, — обещание, которое не сбудется: на неё нажимают.
  for (const к of канд.filter(x => x.выключен)) {
    const собрат = канд.find(x => !x.выключен && x.имя.split('.')[0] === к.имя.split('.')[0]);
    if (собрат && собрат.до.bg === к.до.bg && собрат.до.color === к.до.color && собрат.до.op === к.до.op)
      выключенныеПохожи.push(`${к.имя}${к.текст ? ` «${к.текст}»` : ''}`);
  }
  await ph.close();
  if (немые.length) {
    const m = `${немые.length} из ${канд.length} кнопок не отвечают на наведение: ${немые.slice(0, 5).join(', ')}`;
    fail('состояние', `${m}. Ни цвет, ни фон, ни рамка, ни тень, ни сдвиг не меняются — под курсором элемент остаётся ровно тем же. Посетитель узнаёт, что это кнопка, только нажав; до нажатия страница выглядит картинкой, а не инструментом. Достаточно одного заметного признака и перехода 150–200 мс`);
    say(`  ✗ ${m}`);
  }
  if (безКурсора.length) {
    const m = `кнопка без cursor: pointer — ${безКурсора.slice(0, 4).join(', ')}`;
    fail('состояние', `${m}. Форма курсора — первый и самый дешёвый сигнал «сюда можно нажать», и он единственный работает до всякой анимации. Стрелка над кнопкой читается как «это подпись», и по ней не кликают`);
    say(`  ✗ ${m}`);
  }
  if (выключенныеПохожи.length) {
    const m = `выключенная кнопка выглядит как рабочая: ${выключенныеПохожи.slice(0, 4).join(', ')}`;
    fail('состояние', `${m} — фон, цвет и прозрачность те же, что у активного собрата. По ней нажимают, ничего не происходит, и это читается как поломка сайта, а не как «сейчас нельзя». Выключенное состояние обязано быть видно до нажатия: приглушить и объяснить, чего не хватает`);
    say(`  ✗ ${m}`);
  }
  if (!немые.length && !безКурсора.length && !выключенныеПохожи.length)
    say(канд.length ? `  все ${канд.length} кнопок отвечают на курсор` : '  интерактивных элементов на странице не нашлось');
}

// --- 38. сдвиг макета при загрузке
// Дефект, которого нет ни на одном скриншоте: он живёт в первые 300 мс и после них исчезает.
// Посетитель успевает промахнуться по кнопке, которая уехала под подгрузившейся картинкой, —
// и это единственный дефект, который человек чувствует как «сайт меня обманул».
const P_RESERVE = () => {
  const R = window.__qaRoot ? window.__qaRoot() : document.body;
  const имя = el => el.tagName + (el.id ? '#' + el.id : '') + (el.classList[0] ? '.' + el.classList[0] : '');
  const out = { медиа: [], шрифты: [] };
  for (const el of R.querySelectorAll('img, video, iframe')) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 24 || r.height < 24 || cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.position === 'absolute' || cs.position === 'fixed') continue;
    const атрибуты = el.hasAttribute('width') && el.hasAttribute('height');
    const пропорция = cs.aspectRatio && cs.aspectRatio !== 'auto';
    // Вычисленную высоту спрашивать бесполезно: у отрисованного элемента она всегда в пикселях,
    // задал её автор или вывели из уже загруженной картинки. Косвенный, но надёжный признак
    // заранее размеченной коробки — object-fit: его ставят ровно тогда, когда размеры блока
    // заданы и картинку надо в них вписать.
    const коробка = cs.objectFit && cs.objectFit !== 'fill';
    if (!атрибуты && !пропорция && !коробка) out.медиа.push(`${имя(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  // Свои шрифты без font-display показывают пустоту вместо текста, пока файл едет, а потом
  // подставляют буквы другой ширины — и весь абзац переливается.
  for (const лист of document.styleSheets) {
    let правила;
    try { правила = лист.cssRules; } catch { continue; }
    for (const пр of правила || []) {
      if (pr_isFontFace(пр) && !/font-display/i.test(пр.cssText)) {
        const сем = (пр.style && пр.style.getPropertyValue('font-family')) || '?';
        out.шрифты.push(сем.replace(/["']/g, '').trim());
      }
    }
  }
  function pr_isFontFace(пр) { return пр && пр.constructor && /FontFace/.test(пр.constructor.name); }
  out.медиа = out.медиа.slice(0, 6);
  out.шрифты = [...new Set(out.шрифты)].slice(0, 5);
  return out;
};

say('── 38. СДВИГ МАКЕТА ПРИ ЗАГРУЗКЕ ───────────────────');
{
  const ps = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // Наблюдатель обязан быть поставлен до первого байта: сдвиги, случившиеся до его установки,
  // buffered:true вернёт, а вот случившиеся до самого addInitScript — нет.
  await ps.addInitScript(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver(список => {
        for (const з of список.getEntries()) if (!з.hadRecentInput) window.__cls += з.value;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) { window.__cls = null; }
  });
  await ps.goto(url, { waitUntil: 'networkidle' });
  await ps.waitForTimeout(700);
  const рез = await ps.evaluate(P_RESERVE);
  const cls = await ps.evaluate(() => window.__cls);
  await ps.close();
  let чисто = true;
  if (typeof cls === 'number' && cls > 0.1) {
    чисто = false;
    const m = `суммарный сдвиг макета CLS = ${cls.toFixed(3)} при пороге 0.1`;
    fail('сдвиг', `${m}. Это измеренный факт, а не риск: содержимое реально переехало уже после того, как посетитель начал читать. Дальше он либо теряет строку, либо промахивается по кнопке. Причина почти всегда одна — что-то встало в поток, не заняв места заранее`);
    say(`  ✗ ${m}`);
  }
  if (рез.медиа.length) {
    чисто = false;
    const m = `${рез.медиа.length} медиа без заранее занятого места: ${рез.медиа.join(', ')}`;
    fail('сдвиг', `${m}. Ни width+height, ни aspect-ratio, ни заданной высоты: пока файл едет, элемент занимает ноль, а придя — расталкивает всё под собой. Достаточно проставить исходные width и height (браузер сам выведет пропорцию) или задать aspect-ratio`);
    say(`  ✗ ${m}`);
  }
  if (рез.шрифты.length) {
    чисто = false;
    const m = `@font-face без font-display: ${рез.шрифты.join(', ')}`;
    fail('сдвиг', `${m}. По умолчанию браузер до трёх секунд держит текст невидимым, а затем подставляет буквы другой ширины — заголовки переливаются на глазах. font-display: swap показывает запасной шрифт сразу; optional вовсе отказывается от подмены на медленной сети`);
    say(`  ✗ ${m}`);
  }
  if (чисто) say(typeof cls === 'number' ? `  ничего не переезжает: CLS = ${cls.toFixed(3)}, места под медиа заняты заранее` : '  места под медиа заняты заранее');
}

// --- 39. зум и узкий экран
// Увеличение страницы — не редкость и не признак плохого зрения: им пользуется каждый, кто читает
// с ноутбука вечером. Запрет на зум и раскладка, рассыпающаяся на 320 CSS-пикселях, — один и тот
// же дефект, снятый с двух сторон.
const P_VIEWPORT_META = () => {
  // document.head под --scope не подменяется, поэтому его querySelector родной и честный.
  const meta = document.head.querySelector('meta[name="viewport"]');
  if (!meta) return { нет: true };
  const c = (meta.getAttribute('content') || '').toLowerCase();
  const макс = /maximum-scale\s*=\s*([\d.]+)/.exec(c);
  return {
    нет: false,
    запрет: /user-scalable\s*=\s*(no|0)/.test(c),
    макс: макс ? parseFloat(макс[1]) : null,
    content: c.slice(0, 80),
  };
};
const P_NARROW = () => {
  const R = window.__qaRoot ? window.__qaRoot() : document.body;
  const ДОК = window.__qaBody ? window.__qaBody() : document.body;
  const имя = el => el.tagName + (el.id ? '#' + el.id : '') + (el.classList[0] ? '.' + el.classList[0] : '');
  const окно = document.documentElement.clientWidth;
  const прокрутка = Math.max(ДОК.scrollWidth, document.documentElement.scrollWidth) - окно;
  const широкие = [];
  for (const el of R.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.height < 4) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue;
    // Скроллящийся контейнер шире окна — законный приём (таблица, лента карточек), не дефект.
    const родитель = el.parentElement && getComputedStyle(el.parentElement);
    if (родитель && /auto|scroll/.test(родитель.overflowX)) continue;
    if (r.width > окно + 2) широкие.push(`${имя(el)} ${Math.round(r.width)}px`);
  }
  return { окно, прокрутка: Math.round(прокрутка), широкие: [...new Set(широкие)].slice(0, 5) };
};

say('── 39. ЗУМ И УЗКИЙ ЭКРАН ───────────────────────────');
{
  const pz = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await pz.goto(url, { waitUntil: 'networkidle' });
  await pz.waitForTimeout(120);
  const vm = await pz.evaluate(P_VIEWPORT_META);
  await pz.close();
  const узкая = await browser.newPage({ viewport: { width: 320, height: 640 } });
  await узкая.goto(url, { waitUntil: 'networkidle' });
  await узкая.waitForTimeout(200);
  const нз = await узкая.evaluate(P_NARROW);
  await узкая.close();
  let чисто = true;
  if (vm.нет && !SCOPE) {
    чисто = false;
    const m = 'нет <meta name="viewport">';
    fail('зум', `${m}. Без него мобильный браузер притворяется экраном в 980 CSS-пикселей и ужимает всю страницу целиком: текст выходит нечитаемым, а вся работа над узкой раскладкой не показывается никому. Строка content="width=device-width, initial-scale=1" закрывает вопрос`);
    say(`  ✗ ${m}`);
  }
  if (vm.запрет || (vm.макс !== null && vm.макс < 2)) {
    чисто = false;
    const m = vm.запрет ? `зум запрещён: user-scalable=no (content="${vm.content}")` : `зум ограничен: maximum-scale=${vm.макс} (content="${vm.content}")`;
    fail('зум', `${m}. Увеличить страницу двумя пальцами — единственный способ прочитать мелкое для очень многих, и отнимать его ради того, чтобы раскладка «не поехала», значит чинить симптом вместо причины. Двукратное увеличение обязано оставаться доступным всегда`);
    say(`  ✗ ${m}`);
  }
  if (нз.прокрутка > 1) {
    чисто = false;
    const m = `на 320px страница уезжает вбок на ${нз.прокрутка}px`;
    fail('зум', `${m}. Горизонтальная прокрутка всей страницы — это то же самое, что четырёхкратный зум на настольном экране: строка не помещается, и читать приходится, возя экран влево-вправо на каждой строке. Ширина 320 — не экзотика, это айфон SE и любая страница, увеличенная вчетверо`);
    say(`  ✗ ${m}`);
  }
  if (нз.широкие.length) {
    чисто = false;
    const m = `на 320px шире окна: ${нз.широкие.join(', ')}`;
    fail('зум', `${m}. Элемент не умеет ужиматься — обычно из-за фиксированной ширины, min-width или неразрывной длинной строки. Заменить фиксированную ширину на max-width: 100%, длинным строкам разрешить перенос`);
    say(`  ✗ ${m}`);
  }
  if (чисто) say('  зум не ограничен, на 320px ничего не уезжает вбок');
}

  const allErrs = [...new Set([...earlyErrs, ...consoleErrs])];
if (allErrs.length) {
  fail('консоль', allErrs.slice(0, 3).join(' | ').slice(0, 300));
  say(`── КОНСОЛЬ: ${allErrs.length} ошибок`);
}

await browser.close();

say('════════════════════════════════════════════════════');
const ZONE = SCOPE ? ` в зоне ${SCOPE}` : '';
if (fails.length) {
  say(`ИТОГ: ПРОВАЛОВ ${fails.length}${ZONE}`);
  fails.forEach(f => say(`  • [${f.area}] ${f.msg}`));
} else {
  say(`ИТОГ: ПРОВАЛОВ 0${ZONE}`);
}
if (SCOPE) say(`Это прогон одной секции. Число унаследованных дефектов даёт прогон без --scope.`);
if (notes.length) { say('Разобрать и объяснить (не обязательно дефект):');
  notes.forEach(n => say(`  ? [${n.area}] ${n.msg}`)); }
if (AS_JSON) console.log(JSON.stringify({ url, fails, notes, report: lines }, null, 2));
process.exit(fails.length ? 1 : 0);
