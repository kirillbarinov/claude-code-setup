# Ломатель: round5-praktika.md (Biome в прод-монорепо, 2026)

Старт 02:10, финиш 02:26. Проверяемый отчёт: `round5-praktika.md`. Сырьё автора (22 файла) grep'алось напрямую; своё сырьё — `r5-praktika-breaker-src/` (16 файлов).

**Счёт: СТОИТ 4 · ОСЛАБЛЕНО 4 · ОПРОВЕРГНУТО 0.**
**Итог: подтверждён частично.** Направление вывода (полную миграцию не делать, гибрид) не опровергнуто и по одному пункту усилено. Но четыре несущих формулировки держатся на устаревших либо селективно обрезанных цитатах, причём в трёх случаях опровергающая строка лежала в файле, который автор сам скачал.

---

## Удар 1. «JS-плагины не выпущены; PR #10954 открыт, issue #2469 открыт» → **СТОИТ**

Проверено через GitHub API заново на 2026-07-30 (`pr10954.json`, `issue2469.json`):
- PR #10954 `feat(js_plugin): runtime AST bindings for JS plugins`: `"state":"open"`, `"merged":false`, `"merged_at":null`, `updated_at 2026-07-19T13:39:28Z`.
- Issue #2469 `☂️ JavaScript plugin runtime`: `"state":"open"`, `"closed_at":null`.
- Релизов после 2026-07-19 два (`2.5.5` 2026-07-21, `2.5.6` 2026-07-28), ветки `2.6.x` не существует (`releases.txt`). Grep changelog автора (`biomejs-changelog-latest.md`) по `plugin|js plugin|javascript plugin` → **0 совпадений**.

Ничего не вышло после даты отчёта автора. Утверждение укреплено.

**Но внутри него — ОСЛАБЛЕНО (см. удар 1b).** Автор доказывает ограниченность плагинов дословной цитатой из блога v2 от **2025-06-17**: «These plugins are still limited in scope: They only allow you to match code snippets and report diagnostics on them». На 2026-07-30 это уже неверно как описание текущего состояния. Блог v2.5 (`blog-v2-5.md`, «Biome v2.5—500 Lint Rules, Plugin Code Fix, and Cross-File Linting»), раздел «Plugin improvements»:
> «Plugins can now declare a code fix, where appropriate. To register a code fix, you can use the `=>` symbol and specify the new code.»
> «You can now specify which paths a plugin should be applied to, using the `includes` setting.»

Дословно: «By default, code fixes of plugins are marked as `"unsafe"`, and they are applied when you run `lint` or `check` with `--write --unsafe`.» То есть GritQL-плагины умеют match + diagnostics + **автофикс** + path-scoping. Квалификатор «only allow you to match and report» — годовалый и просроченный; тир при этом тот же (вендорский блог). **Автор этот файл не открывал вовсе** (grep отчёта по `biome-v2-5` → 0).

Практическое следствие для вопроса: порог «кастом сводится к запретить-паттерн» из пункта 3 вывода надо поднять — GritQL-плагин теперь может ещё и починить найденный паттерн.

## Удар 2. «scores 97% compatibility with Prettier» → **ОСЛАБЛЕНО**

Автор процитировал фрагмент до конца оборота, но оборвал предложение ровно перед оговоркой, стоящей в **том же предложении**. Первоисточник (`home.md`, biomejs.dev, снято 2026-07-30), дословно целиком:

> «**Biome is a fast formatter** for *JavaScript*, *TypeScript*, *JSX*, *TSX*, *JSON*, *HTML*, *CSS* and *GraphQL* that scores [**97% compatibility with *Prettier***](https://console.algora.io/challenges/prettier) (**see [known limitations](https://biomejs.dev/formatter/differences-with-prettier/#known-limitations-compared-to-prettier)**), **saving CI and developer time**.»

Два потерянных квалификатора:
1. «(see known limitations)» — вырезано. Целевая страница (`prettier-diffs.md`, снято 2026-07-30) открывается словами: «Biome does not yet support formatting for all languages and frameworks» и далее перечисляет расхождения, включая невалидный-по-TS код, который Prettier форматирует, а Biome отвергает («A function cannot have duplicate modifiers», «non-abstract classes cannot have abstract properties», «An optional chain cannot be assigned», «The `const` modifier cannot be set on a type parameter of an interface»).
2. Сама цифра 97% — не измерение вендора на произвольном коде, а **скор челленджа Algora** (ссылка на `console.algora.io/challenges/prettier` вшита в цифру). Ни версии Biome, ни даты замера рядом нет; на странице их тоже нет.

Вывод пункта 1 («низкий риск») от этого не падает, но обязательный квалификатор при цифре: «97% — скор Algora-челленджа Prettier, без указания версии/даты, при явной вендорской отсылке к known limitations». Для 200k LOC это означает обязательный шаг «прогнать `biome format` и вычитать diff», а не «низкий риск» как данность.

## Удар 3. Ось «~35x» → **СТОИТ**

`home.md`, дословно, две соседние строки: «~35x» / «Faster than Prettier when formatting 171,127 lines of code in 2,104 files with an Intel Core i7 1270P.» Автор процитировал ось (формат vs Prettier, LOC, файлы, железо) верно и сам пометил, что ESLint/type-aware/cold-warm в ней не участвуют. Подмены оси нет. Укреплено.

## Удар 4. «Type-aware правила нестабильны и заведомо неполны» → **ОСЛАБЛЕНО**

Ядро подтверждается: `rule-nofloating.md` (снято мной 2026-07-30) — «Diagnostic Category: `lint/nursery/noFloatingPromises`», «This rule belongs to the nursery group, which means it is not yet stable and may change in the future». В домене `types` 15 правил помечены `(nursery)`, включая `noMisusedPromises`, `useAwaitThenable`, `noBaseToString`.

Но абсолютная формулировка селективна. В **файле самого автора** `biomejs-docs-domains.md`, строки 769–785, домен `types` содержит правила **без** пометки `(nursery)`:
> `useArrayFind` (769), `useConsistentEnumValueType` (783), `noUnnecessaryConditions` (784), `useArraySortCompare` (785)

Причина видна в непрочитанном автором блоге v2.5: «Promoted 73 nursery rules to stable groups», «The release also promotes over 70 rules spread among the Vue framework, **type-aware rules**, and more» — и `noUnnecessaryConditions`, `useArraySortCompare`, `useConsistentEnumValueType` действительно стоят в списках promotion (`blog-v2-5.md`, разделы Promoted to `complexity`/`style`/`correctness`).

Корректная формулировка: «в домене `types` 15 из ~19 правил — nursery, флагманские `noFloatingPromises`/`noMisusedPromises` в nursery спустя год после v2; при этом в v2.5 (релиз 2.5.0 от 2026-06-12) часть type-aware правил выведена в stable-группы». Тезис «нестабильны» верен для того, за чем идут в type-aware (промисы, unsafe-семейство); «заведомо» — перебор.

Попутно: цифра «сотни правил, точное число утверждаю только порядком» (пункт 8 обоснования, оценка по 644 ссылкам) теперь имеет вендорский первоисточник, который автор пропустил: «With this release, Biome has surpassed **500 rules**!» (`blog-v2-5.md`). Осторожность автора не наказывается, но цифра была доступна.

## Удар 5. Измерение charpeni `[1 незав.]` → **ОСЛАБЛЕНО**

Цитаты автора из `charpeni-oxlint.md` сверены — воспроизведены точно, таблица приведена целиком, ось («headline number comes from eliminating ESLint entirely») зафиксирована честно. Претензия не к цитированию, а к тому, что автор оставил решающее измерение на одном свидетельстве и не нашёл второго. Нашёл я — и оно **противоречит по величине**:

- Независимый практик, Peter Bengtsson (`peterbe.md`, https://www.peterbe.com/plog/benchmarking-oxlint-vs-biome), hyperfine, 178–195 файлов: «**tl;dr; `oxlint` is as fast as `biome`**» — «bunx oxlint ran **1.23 ± 0.07 times faster** than bunx biome check» (219.1 ms vs 269.0 ms). И контрнаправление: «`oxlint --type-aware`» 560.4 ms — то есть **Biome вдвое быстрее type-aware Oxlint** на этом репо. Квалификатор: репо маленькое (178 файлов, преимущественно `.tsx`), автор сам отмечает «I think `biome` checks some `.json` files too».
- У charpeni «Lint only (Biome native rules → Oxlint native rules): ~3s → ~0.7s» — это ~4.3×. Независимое измерение даёт 1.23× (паритет). Разброс 3.5× между двумя замерами не позволяет утверждать «Oxlint кратно быстрее Biome» ни в какую сторону.
- Цифры «Oxlint ~2–3× быстрее Biome», которые всплывают в выдаче, ведут на `github.com/oxc-project/bench-javascript-linter` (`oxc-bench.md`): «Oxlint is ~2x faster than Biome», прогоны 2.72×/2.49×/3.31×. Это **репозиторий самого oxc** — стимул `продаёт`, в независимые не считается. Автор его не цитировал и правильно.

Итог: «выигрыш даёт удаление ESLint, а не сам Biome» — тезис **укреплён** (peterbe независимо показывает паритет Biome↔Oxlint на native-правилах, то есть переход между Rust-линтерами ничего не даёт). А вот конкретные кратности лайнт-онли из charpeni воспроизводимости не имеют.

## Удар 6. «Roadmap 2026 не обещает JS-плагины» → **СТОИТ**

Открыл roadmap сам (`roadmap-2026.md`, 2026-01-21) и прогнал синонимы `plugin|extensib|custom rule|gritql|javascript plugin|api`. Всего два попадания, оба про GritQL:
> «Added support for plugins via GritQL. Throughout the year the plugin engine has become even more powerful, allowing users to **query the Biome CST** and report custom diagnostics.»
> «GritQL has now become part of the Biome organization.»

`JS plugin` / `JavaScript plugin` — 0. Проверка синонимами пройдена, пробел автора не сконструирован. Независимо подтверждено ja-каналом: «Biome 2.6 で **JavaScript プラグイン API** の正式リリース予定がある、という確かな情報は…ありません», «正式な JavaScript プラグイン API のリリース時期は未発表». Укреплено.

## Удар 7. Непрочитанные reddit-треды про v2 → **СТОИТ** (пробел реален)

Прошёл лестницу дальше автора, все ступени зафиксированы:
1. `ezycopy https://old.reddit.com/r/javascript/comments/1led1rl/` → **475 байт** (тот же результат, что у автора); `r/typescript/1ldwrxr` → **1353 байта** (тело поста, без комментариев).
2. **`.json`-суффикс с браузерным User-Agent** (ступень, которой не было у автора): `old.reddit.com/…/.json?limit=200` → **HTTP 403**, 189 908 байт, идентичный размер для обоих URL, в теле `theme-beta`-страница блокировки (grep по `whoa|blocked|too many requests` → совпадение). Не контент.
3. Firecrawl v2 по `old.reddit.com`-URL (автор пробовал по `reddit.com`) → `"success": false`, `markdown` длиной 0 по обоим.
4. **Exa `/contents` с `text:true`** (ступень, которой не было ни у кого): по трём reddit-URL → `"status":"error"`, `"httpStatusCode":403`, `"tag":"SOURCE_NOT_AVAILABLE"` для каждого.

Reddit-комментарии закрыты на четырёх ступенях. «Не установлено» у автора — честное, а не процедурная ошибка.

## Удар 8. Рекомендация «кандидат не Biome, а Oxlint» → **ОСЛАБЛЕНО**

Автор снабдил Oxlint единственным квалификатором — «JS plugins are currently in alpha». В том же файле, который автор скачал и цитировал (`charpeni-oxlint.md`, 2026-05-13), лежит второй квалификатор, ровно про рекомендуемый сценарий «много кастомных плагинов», и он вырезан:

> Строка 69: «Oxlint currently has a performance cliff when you have **4+ JS plugin *names*** active simultaneously, going from **~2.5s to ~38s** in our case. We worked around it by keeping ourselves to 3 plugins. Worth knowing if you're planning to lean heavily on JS plugins.»
> Строка 71, **Update** (обязателен к цитированию вместе с предыдущим): «the slowdown was **not** caused by crossing four JS plugin names. The expensive case was `eslint-plugin-react-compiler` specifically when run through Oxlint's JS plugin API. A fourth no-op JS plugin did not reproduce the slowdown, while React Compiler alone did.»

То есть 15-кратная деградация на JS-плагинах у Oxlint зафиксирована, автором частично отозвана и переатрибутирована конкретному плагину — но факт остаётся: тяжёлый ESLint-плагин через Oxlint JS plugin API может обвалить пайплайн, и команда его в итоге **удалила**, а не заставила работать. Для монорепо с кастомными плагинами это тот же класс риска, что и «alpha», и он должен стоять в выводе.

Симметрично — в плюс Oxlint, тоже из непрочитанного автором места того же файла (строка 99): «Oxfmt formats code embedded in JS/TS template literals (CSS-in-JS, GraphQL, HTML, and similar) via its embedded formatting feature. It works, but output may differ slightly from Prettier inside those blocks.» Это прямо закрывает ту дыру, из-за которой в секции «Кто не согласен» практик sibeliuss откатился с Biome-форматтера (`graphql` в template literals), и роадмап Biome 2026 всё ещё держит её в планах. Автор сопоставление не сделал.

## Довесок: неиспользованное сырьё, усиливающее автора

В файле автора `solberg-typeaware.md` лежит независимая внешняя цитата по решающему для type-aware вопросу, не попавшая в отчёт:
> Evan You: «Biome's type-aware linting is based on a **custom type synthesizer** — it **cannot guarantee full coverage or behavior alignment with official TS**.» (via https://www.solberg.is/fast-type-aware-linting, цит. по x.com/youyuxi/status/1946510002518466926)

Плюс монорепо-практик с числами: «a cold run of `typescript-eslint` on our monorepo at TripToJapan.com is **7 minutes**», «Both **Biome 2** and **Oxlint** can lint our entire codebase in < 1.5 s». Это частично закрывает пункт «Не установлено: свежие отчёты о монорепо с числами» — с квалификаторами: LOC не указаны, статья 2025 года (её таймлайн говорит «Q3 2025 (expected) – Biome expands to ~10 type-aware rules», апдейт про «July 28 launch of typed rules» — 2025), и в ней есть проверяемая ошибка датировки («April 2024 – Biome ships `noFloatingPromises`», тогда как правило доступно с v2.0.0, релиз 2025-06). Как источник по числам — с оговоркой, как второй голос про custom type synthesizer — годится.

## Скорректированный вывод

Ранжирование шагов **не меняется**: Prettier→Biome formatter → Biome вторым линтером → полный отказ только при сводимости кастома к GritQL → Oxlint как альтернативный кандидат. Правки внутри пунктов:

1. **Шаг 1** — не «низкий риск» безусловно, а «низкий риск при обязательной вычитке diff'а»: 97% — скор Algora-челленджа без указания версии/даты, вендор в том же предложении отсылает к known limitations, среди которых отказ форматировать TS-невалидный код. Для GraphQL/CSS-in-JS в template literals дыра открыта и стоит в планах 2026.
2. **Шаг 3** — порог поднять: GritQL-плагины с v2.5 умеют не только «match и report», но и code fix (`=>`) и path-scoping через `includes`. Больше кастомных правил проходит порог, чем следует из цитаты автора 2025-06-17.
3. **Type-aware** — формулировка «в домене `types` 15 из ~19 правил nursery, промис-семейство в nursery спустя год; часть type-aware выведена в stable в v2.5». Внешний довод к осторожности — Evan You про custom type synthesizer без гарантии alignment с TS.
4. **Шаг 4 (Oxlint)** — два квалификатора вместо одного: «JS plugins are currently in alpha» **и** зафиксированный обвал ~2.5s → ~38s на тяжёлом ESLint-плагине через JS plugin API (переатрибутирован `eslint-plugin-react-compiler`, плагин в итоге удалён). Контрвес в пользу Oxlint: Oxfmt умеет embedded formatting в template literals — то, чего Biome не умеет.
5. **Кратности скорости между Rust-линтерами не утверждать.** charpeni (4.3× lint-only) против независимого peterbe (1.23×, паритет; Biome вдвое быстрее `oxlint --type-aware`); «~2×» из oxc-репозитория — стимул `продаёт`. Тезис «выигрыш от удаления ESLint, а не от смены Rust-линтера» этим укреплён.

## Что проверялось и не дало результата

- Релизы/ченджлог после 2026-07-19 на предмет JS-плагинов — пусто (нет 2.6, grep `plugin` по changelog 2.5.4→latest = 0).
- Контрзапросы: «Biome migration regret / switched back to ESLint 2026 monorepo problems»; «Oxlint vs Biome benchmark 2026 «Biome slower»»; «site:reddit.com Biome v2 type-aware plugins monorepo»; ja «Biome 2.6 JavaScript plugin API リリース 予定 ESLint プラグイン 移行 できない 2026». Ни один не дал датированного отчёта о полном откате с Biome v2 (не v1) в монорепо. Всё, что выдаётся в 2026-м — недатированные SEO/AI-страницы (devtoolbox.blog, toolchew.com, pkgpulse.com, abrarqasim.com, jsmanifest.com, noqta.tn), в независимые не берутся. Пробел автора здесь реален.
- Perplexity: 4 вызова, `sonar`, `max_tokens` 1200 (en ×2, en-reddit ×1, ja ×1). Открыто/сохранено: 16 файлов в `r5-praktika-breaker-src/` (biomejs.dev ×7, бенчмарки ×3, reddit-попытки ×5 включая провалы, GH-выгрузки ×7 JSON).
