@RTK.md

# Confidence Rule

Do not make any changes until you have 95% confidence in what you need to build. Ask me follow-up questions until you reach that confidence.

# Поиск в интернете — «Воронка» (v2)

**Канал.** Любой поиск идёт ТОЛЬКО через `mcp__perplexity-mcp__perplexity_search_web` (в главном контексте) плюс каналы внутри субагента `researcher`. Встроенный `WebSearch`/`WebFetch` не использовать; прямой `curl`/`wget` по публичному URL — тоже нет (guard режет). Не отвечать «из головы», если вопрос требует данных из интернета, — сначала искать.

**Принцип.** Поисковик-синтезатор — инструмент обнаружения, а не ответа: синтез это и есть «первые ссылки, пропущенные через ИИ». Единица работы — утверждение + независимые источники под ним, открытые самостоятельно. Чистый синтез без открытых страниц не отдаётся ни в одном режиме.

**Точка входа — скилл `research`.** Он держит всю процедуру: классификацию (ФАКТ / ПРАКТИКА / ВЫБОР / СОСТОЯНИЕ — по типу решающих доказательств, не по форме фразы), выбор режима (quick инлайн / standard и wide в субагенте `researcher`), стадии воронки и форму отчёта. Класс и режим анонсировать одной строкой до поиска («класс ВЫБОР → wide, ~20 мин»). Ломатель обязателен для wide и для standard, когда факт идёт в код, деньги или необратимое решение; поправка ломателя побеждает. Главный контекст не забивается: наружу выходит только сводка.

**Мимо поиска:** библиотеки/API/конфиги → Context7; известен URL → `ezycopy <URL>`; длинный документ → `ctx_fetch_and_index` + `ctx_search`; «откуда взялся факт» / видео → скиллы `source-finder` / `youtube-search`; факт из claude-mem — кандидат с датой источника, не ответ.

**Форма ответа:** Вывод / Обоснование / Кто не согласен / Не установлено / Покрытие. Каждое утверждение — с числом независимых источников, URL и датой источника, не сегодняшней. Не нашёл → «не найдено такими-то каналами», не правдоподобная заготовка. Cutoff — май 2026: всё после искать обязательно, полгода до — проверять.

**Локальные хосты** (localhost, 127.x, 10.x, 192.168.x, 172.16–31.x) `curl`'ом не блокируются.

**Фолбэк при мёртвом Perplexity:** `touch ~/.claude/perplexity-guard.disabled` — 10-минутное окно встроенного поиска; удалить флаг, когда ожил. Воронка не меняется — меняется канал обнаружения.

> Принуждение: hook `perplexity-guard.sh` (`PreToolUse` на `WebSearch|WebFetch` и `Bash`) блокирует встроенный веб-поиск и публичный `curl`/`wget` для главного агента, редиректит в Perplexity. Субагенты пропускаются по top-level полям `agent_id`/`agent_type` (именованный агент шлёт только `agent_type`; парсинг `jq`, не grep). Решения пишутся в `~/.claude/perplexity-guard.log`. Другие MCP (context-mode, Exa, Firecrawl) не покрываются.

# Context7 — When to Use

Use `mcp__context7__resolve-library-id` + `mcp__context7__query-docs` proactively, without an explicit user request.

**Activate when:**
- Writing code with any external library/framework (primary trigger)
- Creating or editing config files (vite, tailwind, prisma, next.config, etc.)
- Fast-moving frameworks (Next.js, Tailwind v4, React 19, etc.)
- Unfamiliar or rarely used library — always
- Question about API, syntax, or configuration options

**Do not activate when:**
- Pure business logic with no external dependencies
- Algorithms and data structures
- Refactoring existing code without new libraries
- Already fetched docs for this library in the current session (reuse them)

# Skills

Use the Skill tool autonomously — invoke any skill whenever you judge it appropriate, not only when the user types a slash command. If a task matches a skill's description or trigger conditions, call it proactively. This applies to all agents, including subagents spawned via /team.

# web-test — авто-запуск браузерного smoke-теста

Скилл `web-test` гоняет «золотой путь» приложения в реальном браузере через изолированный субагент `web-test-runner` (браузерный шум не попадает в основной контекст; возвращается только компактный `VERDICT`). Запускать его проактивно, не дожидаясь `/web-test`.

**Запускать, когда:**
- Внёс изменения в UI/фронт (компонент, страница, стиль, роут) и нужно убедиться, что страница рендерится и работает.
- Пользователь просит «открой/запусти/проверь приложение в браузере», «посмотри как выглядит», «проверь, что не сломалось визуально».
- Нужно проверить конкретный флоу (логин, сабмит формы, навигация) после правок.
- Перед тем как сказать «готово» по фронтовой задаче — быстрый smoke как verification.

**НЕ запускать, когда:**
- Правки только в бэке/CLI/библиотеке без браузерного UI.
- Чисто бизнес-логика, конфиги, рефактор без видимого эффекта в браузере.
- Нет dev-сервера / это не веб-проект.
- Уже прогнал smoke в этой сессии и с тех пор фронт не менялся (не повторять без причины).

**Как:** только через скилл/субагент — сам в основной сессии браузер, dev-сервер и Playwright НЕ поднимать. Передавай субагенту хинт (URL/порт/флоу), если он известен. Это smoke, а не полный QA/секьюрити — для глубокого прогона есть `security-auditor`.

# Диаграммы — archify или artifact-diagramming

Развилка по предмету, не по инструменту. Не спрашивать пользователя, выбирать самому.

**archify** — когда предмет это система и она укладывается в одну из пяти форм:
архитектура, workflow, sequence, data flow, state machine. Также конвертация Mermaid.
Причина: раскладку и трассировку рёбер считает компилятор, IR типизирован и валидируется,
правки вносятся репликой в чате, есть delta между двумя снимками и экспорт PNG/SVG/WebM.
Ручной SVG на схеме от 10 узлов даёт пересечения стрелок и съехавшие подписи — archify нет.

**artifact-diagramming** — когда предмет это идея, а не система: сравнение вариантов,
устройство алгоритма, таймлайн, мысленная модель. В пять форм не ложится — не натягивать.
Также когда нужна ссылка сразу, без промежуточного файла.

**Шаринг:** выход archify самодостаточен (~800 КБ, ноль внешних ссылок), лезет в лимит
артефакта. Нужна ссылка на системную схему — archify рисует, публикация артефактом раздаёт.

# Subagents

Use subagents for any exploration or research. If a task needs 3+ files or multi-file analysis, spawn a subagent and return only summarized insights.

## Web Fetching Rules
When you need to read the contents of a webpage or documentation via URL, you are STRICTLY FORBIDDEN to use built-in web_fetch tools or browser MCPs. 
Instead, always run the following command in the terminal: `ezycopy <URL>`. 
Read the terminal output — it will be clean Markdown stripped of junk. Use it for your analysis.

# Applied Learning

When something fails repeatedly, when the user has to re-explain, or when a workaround is found for a platform/tool limitation, add a one-line bullet here. Keep each bullet under 15 words. No explanations. Only add things that will save time in future sessions.

- Грабли дизайн-цикла (пробы, снимки, OpenRouter/fal, вёрстка) — в `~/.local/share/design-skills/LEARNED.md`, не сюда.
- sudo -S + heredoc на ssh: пароль съедает первую строку. Пиши в /tmp без sudo, потом sudo cp.
- Агент с `name:` + whitelist `tools:` без SendMessage = пустой idle. Адресат отчёта — `team-lead`, не `main`.
- `yandex.cloud` отдаёт капчу. Обход: `aistudio.yandex.ru` или репо `yandex-cloud/docs`.
- ezycopy теряет таблицы в Mintlify-табах. Обход: `ctx_fetch_and_index` + `ctx_search`.
- Попутный факт («только», «везде») цитируется тем же тиром. Перепроверяй по странице.
- garant.ru через ctx_fetch_and_index даёт битую кириллицу. Обход: kremlin.ru/acts, consultant.ru.
- publication.pravo.gov.ru отдаёт текст закона сканом. Карточка читаема, текст — нет.
- ezycopy на JS-странице возвращает 300 байт cookie-баннера как «успех». Проверяй объём.
- JS-страница пуста в ezycopy — пробуй тот же URL с суффиксом `.md` (`/faq.md`).
- Кодифицированный текст НК с «в ред. ФЗ от…» — consultant.ru. Гарант отстаёт.
- Справка ГПУ обрывает норму: «за 2030 год» без «и последующие годы». Цитируй до точки.
- ID документа на publication.pravo.gov.ru не угадывать — ведёт к чужому акту.
- Прячется за JS-селектором — ищи в `<домен>/llms.txt`, только `-o` + grep.
- «Issue открыт» — проверяй `state` и текущий код в main, не заголовок.
- «Не существует» недоказуемо. Пиши «не найдено такими-то каналами».
- Отчёт researcher'а — прогнать `validate-research-report.py`: форма, бесплатно.
- Число из API утверждай порядком, если пересчёт даёт другое.
- Именованный агент (`name:`) шлёт в hook-input `agent_type` без `agent_id`. Guard проверяет оба.
- Интегральный % метрики скрывает профиль. Решает таблица по диапазонам под критерий вопроса.
- Противоречие источников сначала grep'ай по своим же сохранённым файлам — часто потерян квалификатор.
- Число с вшитой ссылкой — сначала открой источник цифры (методика, дата, оговорки).
- Ось сравнения цитируй вместе с числом: что vs что, какие версии.
- Exa не достаёт Reddit (403). Только двухходовка Perplexity → old.reddit.
- Цитата о возможностях инструмента — сверяй с последним релизом, не с датой поста.
- «Не поддерживается» из поста — проверь текущий state трекера: блокер мог закрыться.
- «Источник не найден» — сначала сверь дату/URL искомой статьи: возможно, искал другую.
- `/usr/bin/python3` — заглушка Xcode (exit 69). Рабочий: `/opt/homebrew/bin/python3`.
- chrome-devtools пишет скриншот только внутрь cwd-проекта. Сохраняй туда, потом mv.
- ezycopy падает x509 на госсайтах РФ (Минцифры CA). Ищи канал перебором t.me/s/.
- Осиротевшие tmux `claude-swarm-<pid>` съедают pty → «fork failed: Device not configured». Жнец в SessionStart/End.
- Cursor snapshots с root=home: 241GB за час, refs=0 → мусор, сносить.
- perplexity-guard режет heredoc с URL внутри текста. Пиши такой файл нативным Write.
- Файл на 2500 строк в контекст субагента = autocompact thrashing. Давай фрагментами.
- Забрал отчёт агента — сразу TaskStop. Сам он не умирает, копится в панели.
- Агент с `name:` живёт как teammate: TaskOutput его не видит, отчёт молчит. Спавни без имени.
- Ollama режет контекст до 4096. Лечит OLLAMA_CONTEXT_LENGTH + LaunchAgent (launchctl setenv не переживает ребут).
- Ollama: KV = 32 KiB/токен; превышение n_ctx не ошибка, а тихая обрезка context-shift.
- `ollama serve` руками из shell не видит `launchctl setenv` → молча 4096. Владелец сервера — Ollama.app.
- opencode: `options.num_ctx` не пробрасывается через `/v1`. Контекст задаёт только сервер Ollama.
- Порог автокомпакта = autoCompactWindow − 33000 (резерв 20k + Ten 13k). ×0.8 — это прекомпьют, не сжатие.
- autoCompactWindow < 200000 отключает прекомпьют: гейт H4n `window < uB(200000)` при явном source.
- Минимум порога с живым прекомпьютом = 200000 − 33000 = 167k (16.7% от 1M). Ниже — только патч бинарника.
- CLAUDE_AUTOCOMPACT_PCT_OVERRIDE не спасает: Lbt = min(0.8·Nj, порог) схлопывает взвод на порог.
- Координаты посёлка по памяти врут на десятки км. Сверяй до вывода.
- bash не понимает кириллицу в именах переменных; `bash -n` это не ловит.
- Starlette не узнаёт кириллицу в `{имя:path}` — маршрут молча становится литералом.
- Testcontainers в gradle-контейнере: -v /var/run/docker.sock + TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal.
- ЧИТАТЬ .docx/.pptx/.xlsx/.pdf — только `anydoc`, не скиллы docx/pdf/xlsx: pandoc и pypdf не установлены.
- СОЗДАВАТЬ/править .docx и .xlsx — штатные скиллы: python-docx и openpyxl на месте.
- PreCompact-лимитер дублирует нативную защиту от thrashing и глушит компакт. Не нужен.
- typescript@7 — нативный Go-порт без tsserver.js. LSP чинит вложенный typescript@5 в tsls.
- npm 12 требует Node ^22 || ^24 || >=26 — ветку 25 не поддерживает. Сейчас Node 26 + npm 12.
- Боевой perplexity-MCP — локальная сборка ~/.claude/mcp, не глобальный npm. Обновлять обе.
- rtk 0.49 починил грабли grep/cat/npx из 0.29. `rtk proxy` как обход больше не нужен.
- `brew uninstall` тянет autoremove. Снёс gemini-cli — утащил сам node. Сначала `brew uses --installed`.
