/* Прогрев страницы перед снимком — общий для `shot.mjs` и для любых скриптов наборов.
 *
 * Зачем отдельный модуль. Урок про `loading="lazy"` был выучен один раз и жил внутри `shot.mjs`.
 * Скрипт набора кадров писался копированием шаблона, `shot.mjs` не звал — и снял четыре карточки
 * витрины, из которых две ниже первого экрана вышли пустыми прямоугольниками. Слепой критик
 * честно потратил на них своё главное замечание: «половина ряда — заглушки, секция выглядит
 * недоделанной». Дефекта вёрстки не было вовсе, в живом браузере все четыре фотографии на месте.
 * Съёмка соврала, а стоила эта ложь целого раунда критики.
 *
 * Поэтому прогрев живёт здесь, а не в одном инструменте: любой скрипт, снимающий кадр, обязан
 * позвать `warm(page)` перед `screenshot`. Проверка `cold` возвращает то, что так и не приехало, —
 * это уже дефект страницы, и о нём надо говорить вслух, а не отдавать критику молча.
 */

/** Проходит страницу до низа и обратно, ждёт декодирования всех картинок. */
export async function warm(page, { settle = 400 } = {}) {
  await page.evaluate(async () => {
    // html{scroll-behavior:smooth} превращает каждый scrollTo в анимацию: проход не доезжает до низа,
    // ленивые картинки внизу не начинают грузиться, и их decode() висит вечно — глушим на время прогрева.
    const st = document.createElement('style');
    st.textContent = 'html,body,*{scroll-behavior:auto !important}';
    document.head.appendChild(st);
    const step = Math.max(400, window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise(r => requestAnimationFrame(r));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    // `decode()` ждёт именно готовности к отрисовке: `complete === true` её не гарантирует,
    // а при `decoding="async"` кадр успевает уйти в файл раньше, чем картинка попадёт на холст.
    // Картинка, которую браузер так и не начал грузить, держит decode() бесконечно — потолок 4 с.
    const cap = new Promise(r => setTimeout(r, 4000));
    await Promise.race([Promise.allSettled([...document.images].map(i => i.decode().catch(() => {}))), cap]);
    st.remove();
    await new Promise(r => requestAnimationFrame(r));
  });
  if (settle) await page.waitForTimeout(settle);
}

/** Список картинок, которые так и не загрузились: это дефект страницы, а не съёмки. */
export async function cold(page) {
  return page.evaluate(() =>
    [...document.images].filter(i => !i.naturalWidth).map(i => i.currentSrc || i.src || i.alt || '(без src)'));
}

/**
 * Снимок полотна целиком. Не `fullPage`, а вьюпорт во всю высоту страницы:
 * `fullPage` рисует область за пределами вьюпорта отдельным проходом, и то, что браузер туда
 * ещё не отрисовал, попадает в файл пустым. Высокий вьюпорт делает всю страницу видимой
 * по-настоящему — но перевёрстка под новую высоту снова поднимает ленивые картинки, поэтому
 * прогрев повторяется уже после смены размера.
 */
export async function shootFull(page, path, { maxHeight = 20000 } = {}) {
  const vp = page.viewportSize();
  await warm(page, { settle: 0 });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: vp.width, height: Math.min(h, maxHeight) });
  await warm(page);
  const missing = await cold(page);
  await page.screenshot({ path });
  await page.setViewportSize(vp);
  return missing;
}
