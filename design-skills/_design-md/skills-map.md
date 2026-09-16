# Карта скиллов дизайн-цикла

Вынесено из §2з и «Установленный внешний набор» `design-director.md` 2026-09-04. Номера строк §2з сверены заново: заголовки-браузья («2б», «2з») — не markdown-заголовки, а инлайн-жирный текст внутри раздела «2. Направление», и их фактическое положение (307–308) отличается от черновой оценки в спеке.

## Когда какой скилл (§2з)

**2з. Библиотека вкуса.** У модели нет памяти о том, что тебе нравилось, поэтому память ведётся руками: удачные референсы складывай в `.design/refs/` проекта — скриншот, URL и строка словаря (как называется приём: «диагональный переход», «индекс-колонка, скроллящаяся вдоль текста»). Библиотека — это вход в п. 2а; без неё каждый запуск начинается с медианы обучающей выборки.

Где брать материал бесплатно: **Dribbble**, **Pinterest**, **X/Twitter** (лента дизайнеров) — общее направление; **21st.dev** — готовые React/Tailwind-компоненты как срез актуального уровня отделки, смотри на них как на референс детализации, а не как на библиотеку для копипаста; **Coolors** — подбор и экспорт палитры. Референс без разобранного рецепта (п. 2ж) в библиотеку не кладётся — иначе это папка с картинками, а не память.


### Выбор скиллов для §2 (перенесено из директора, строки 336–351)

Скиллы: всегда `design-taste-frontend` (анти-шаблонная база).
Плюс один стилевой, по характеру продукта:
- `high-end-visual-design` — премиум-агентский лоск, глубина, микровзаимодействия
- `minimalist-ui` — редакторская сдержанность, тёплый монохром, бенто, без градиентов
- `industrial-brutalist-ui` — жёсткая сетка, экстремальный контраст кеглей, дата-плотность
- `gpt-taste` — когда моушн на GSAP несущий (пиннинг, скраб, стекинг)
- `redesign-existing-projects` — редизайн: сначала аудит текущего, потом правки без слома функциональности
- `theme-factory` — когда нужна готовая калиброванная пара «палитра + шрифты»
- `brandkit` — когда просят айдентику/логотип/бренд-борд
- `algorithmic-art` / `canvas-design` — генеративная графика и canvas-композиции, когда фон/паттерн должен быть уникальным, а не стоковым
- `web-artifacts-builder` — одностраничные самодостаточные артефакты (демо, отчёт, презентация)
- `full-output-enforcement` — когда ответ длинный и есть риск обрезки

**Стилевые рецепты (~85 штук, установлены локально).** Когда направление уже выбрано словами, но нужен именованный рецепт с готовыми токенами — бери подходящий скилл вместо того, чтобы изобретать палитру с нуля: `dark-glass-clean-layout`, `light-mode-paper-technical`, `clean-minimal-beige-light-mode`, `documentary-brutalist-agency`, `editorial-portfolio-chapters`, `mesh-gradient-dark-blue-clean`, `framed-tech-dark-border-gradient`, `nested-container-clean-agency`, `skeuomorphic-ui`, `orange-clean-paper-saas`, `product-proof-saas`, `operational-enterprise-ai`, `agency-grid-layout-minimal`, `split-layout-technical`, `book-serif-index` и другие — полный список видно в перечне скиллов. Рецепт — это стартовая точка для п. 2е (веер), а не готовый ответ: как минимум один осознанный отказ от его дефолтов обязателен.

**Продуктовые:** `landing-page-design` (интейк → структура → конверсионный копирайт → типографика и отступы), `landing-page`, `pricing-page`, `web-design-engineer` (советник направления по школам + рубрика критики).

## Установленный внешний набор

Ниже — что уже стоит в `~/.claude/skills` (симлинки на `~/.local/share/design-skills/_vendor/`, обновление — `git pull` в соответствующем каталоге). Отобрано только то, что относится к дизайну, UX и UI; игровые, свифтовые, публикационные и чужие генераторы изображений сознательно не подключены.

| Источник | Что даёт | Когда звать |
|---|---|---|
| `MengTo/Skills` → `agent-skills/web-design` | ~85 скиллов: стилевые рецепты, GSAP/ScrollTrigger, Lenis, three.js/WebGL, шейдерные курсоры, скролл-миры, частицы, Matter.js, Cobe, Vanta, Tailwind | пп. 2е (веер), 5 (реализация приёма), 5б (3D) |
| `jakubkrehel/skills` | `better-layout`, `better-typography`, `better-colors`, `better-ui`, `better-accessibility`, `better-writing`, `better-interface`; `interface-review`, `variant`, `break`, `explain-interface` | п. 6 (проверка), п. 2е (`variant`), разбор чужого эффекта (`explain-interface`) |
| `emilkowalski/skills` | `animate`, `animation-vocabulary`, `improve-animations`, `review-animations`, `find-animation-opportunities`, `apple-design`, `emil-design-eng`, `prototype`, `pick-ui-library` | любой моушн: точные кривые и длительности вместо «сделай плавно» |
| `ConardLi/garden-skills` | `web-design-engineer` — советник направления и рубрика критики на 5 измерений | п. 2а/2е |
| `elayadesign/ai-design-skills` | `landing-page-design` | лендинги |

Полезные одиночки из того же набора: `interface-review` — ревью незакоммиченных правок, ветки или PR по всем дисциплинам; `break` — компонент во всех состояниях как визуальный отчёт; `audit-reference-originality` — проверка, не скопирован ли референс слишком буквально (прямое дополнение к п. 2ж); `stitched-full-page-capture` — полностраничные скриншоты ленивых/скролл-анимированных страниц, когда обычный снимок выходит пустым; `optimize-web-animations` — профилирование и починка анимаций, съедающих кадры.

**Граница с правилом 1.** Чужие скиллы иногда советуют Midjourney, Nano Banana, DALL·E, fal.ai, Replicate, Unsplash. Любая такая рекомендация игнорируется: генерация идёт только через `openrouter-images` / `openrouter-video`, фото — только сгенерированные там же. То же и с плейсхолдер-хостами: `picsum.photos`, Unsplash, Pexels, placehold.co запрещены полностью, включая «временно, потом заменю» — страница с плейсхолдером считается недоделанной, а не черновиком.

Пять найденных нарушений уже переписаны локально (`design-first-ui-prompting/ARTICLE.md`, `design-taste-frontend`, `gpt-taste`, `minimalist-ui`, `redesign-existing-projects`), а семь скиллов Higgsfield сняты из `~/.claude/skills` в `~/.claude/skills-disabled-higgsfield`. Встретишь новое нарушение после `git pull` — не выполняй его и скажи об этом в отчёте.

Бесплатные источники материала: **polyhaven.com**, **ambientcg.com** (HDRI и PBR, CC0) — п. 5б; **21st.dev**, **Coolors**, Dribbble/Pinterest/X — п. 2з.

Плагин `impeccable` стоит локально — им вычищается «слоп» в тексте интерфейса перед сдачей.

## Эффект → скилл (обязательный вызов до кода эффекта)

| Эффект | Скилл |
|---|---|
| вход слов заголовка | `staggered-word-reveal` |
| раскрытие маской | `masked-reveal` |
| прогрессивное размытие края или медиа | `progressive-blur` |
| пин, скраб, стекинг, Lenis | `cinematic-gsap-lenis-motion-system`, `gsap-scrolltrigger-storytelling` |
| скролл-раскрытие текста | `scroll-scrubbed-word-reveal` |
| стекло, пилюля-навбар | `glass-dark-ui` |
| выбор типа движения и кривой при сомнении | `animate`, `animation-systems` |
| ревизия уже написанных анимаций | `improve-animations`, `optimize-web-animations` |

«Помню, как делается» вызовом не считается: скилл читается в этом запуске.

