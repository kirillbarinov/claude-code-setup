@RTK.md

# Confidence Rule

Do not make any changes until you have 95% confidence in what you need to build. Ask me follow-up questions until you reach that confidence.

# Поиск в интернете — «Воронка» (v2)

**Канал.** Любой поиск идёт ТОЛЬКО через `mcp__perplexity-mcp__perplexity_search_web` (в главном контексте) плюс каналы внутри субагента `researcher`. Встроенный `WebSearch`/`WebFetch` не использовать; прямой `curl`/`wget` по публичному URL — тоже нет (guard режет). Не отвечать «из головы», если вопрос требует данных из интернета, — сначала искать.

**Принцип.** Поисковик-синтезатор — инструмент обнаружения, а не ответа: синтез это и есть «первые ссылки, пропущенные через ИИ». Единица работы — утверждение + независимые источники под ним, открытые самостоятельно. Чистый синтез без открытых страниц не отдаётся ни в одном режиме.

**Точка входа — скилл `research`.** Он держит всю процедуру: классификацию (ФАКТ / ПРАКТИКА / ВЫБОР / СОСТОЯНИЕ — по типу решающих доказательств, не по форме фразы), выбор режима (quick инлайн / standard и wide в субагенте `researcher`), стадии воронки и форму отчёта. Класс и режим анонсировать одной строкой до поиска («класс ВЫБОР → wide, ~20 мин»). Ломатель обязателен для wide и для standard, когда факт идёт в код, деньги или необратимое решение; поправка ломателя побеждает. Главный контекст не забивается: наружу выходит только сводка.

**Мимо поиска:** библиотеки/API/конфиги → Context7; известен URL → `ezycopy <URL>`; длинный документ → `ctx_fetch_and_index` + `ctx_search`; факт из claude-mem — кандидат с датой источника, не ответ.

**Форма ответа:** Вывод / Обоснование / Кто не согласен / Не установлено / Покрытие. Каждое утверждение — с числом независимых источников, URL и датой источника, не сегодняшней. Не нашёл → «не найдено такими-то каналами», не правдоподобная заготовка. Cutoff — май 2026: всё после искать обязательно, полгода до — проверять.

**Локальные хосты** (localhost, 127.x, 10.x, 192.168.x, 172.16–31.x) `curl`'ом не блокируются.

**Фолбэк при мёртвом Perplexity:** `touch ~/.claude/perplexity-guard.disabled` — 10-минутное окно встроенного поиска; удалить флаг, когда ожил. Воронка не меняется — меняется канал обнаружения.

> Принуждение: hook `perplexity-guard.sh` блокирует встроенный веб-поиск и публичный `curl`/`wget` для главного агента; субагенты пропускаются. Устройство, кого пропускает, журнал, фолбэк — `~/.claude/docs/perplexity-guard.md` (читать при отладке guard, не заранее).

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

**Запрет касается чтения содержимого страницы по URL, не управления браузером.**

Нужно прочитать страницу или документацию по URL — built-in `web_fetch` и браузерные MCP
ЗАПРЕЩЕНЫ. Только `ezycopy <URL>` в терминале: на выходе чистый Markdown без мусора.

Браузерные MCP (`chrome-devtools`, `claude-in-chrome`) остаются штатным инструментом там, где
предмет — **работающее приложение, а не текст страницы**: smoke через `web-test`, проверка
вёрстки скриншотами в `design-director`, отладка консоли и сети. Это не обход правила выше —
разные задачи.

# Вики проектов

Знания по каждому проекту — `~/.claude/wiki/<проект>/`. Router проекта уже в контексте (хук на
старте). Порядок: router → нужные `pages/` (не больше 5) → grep/glob. Файл из `sources` страницы
новее её `updated` — верить файлу. Вопрос про несколько проектов — начать с
`~/.claude/wiki/_index.md`. Вики руками не править — скилл `wiki`.

# Карта расположения

Где что физически лежит. Это роутер: не помнить содержимое, а знать адрес.
Ссылки отсюда проверяет скилл `os-audit` — карта не протухает молча.

| Что | Где |
|---|---|
| Глобальные правила (этот файл) | `~/.claude/CLAUDE.md` |
| RTK — токен-прокси | `~/.claude/RTK.md` |
| Превентивные грабли | здесь, блок Applied Learning ниже |
| Диагностические грабли | `~/.claude/LEARNED.md` |
| Грабли дизайн-цикла | `~/.local/share/design-skills/LEARNED.md` |
| Механика perplexity-guard | `~/.claude/docs/perplexity-guard.md` |
| Свои скиллы | `~/.claude/skills/<name>/SKILL.md` |
| Свои агенты | `~/.claude/agents/<name>.md` |
| Хуки | `~/.claude/hooks/` |
| Настройки и регистрация хуков | `~/.claude/settings.json` |
| Боевая сборка perplexity-MCP | `~/.claude/mcp` |
| Журнал решений guard | `~/.claude/perplexity-guard.log` |
| Отчёты аудита сетапа | `~/.claude/audits/` |
| Бэкапы памяти claude-mem | Google Drive → `claude-mem-backup/` (7 последних); другая папка — `CLAUDE_MEM_BACKUP_DIR` |
| Окружение claude-mem (таймаут LLM) | блок `env` в `~/.claude/settings.json` — settings.json самого claude-mem его не читает |
| Канал наблюдателя claude-mem | `~/.claude/hooks/claude-mem-provider.sh` — подписка основным, OpenRouter запасным, переключает сам |
| Состав цепочки моделей OpenRouter | `~/.claude/hooks/claude-mem-model.sh` — показать, `backup` / `main` — переключить |
| Состояние фоновых задач | `~/.claude/state/` |
| Задачи по расписанию | `~/Library/LaunchAgents/local.claude-*.plist` |
| Рабочий python | `__PYTHON__` |
| Вики проектов | `~/.claude/wiki/` (git), индекс `_index.md`, исключения `_exclude.txt` |
| Движок вики | `~/.claude/wiki-engine/`; очередь, состояние, лог — `~/.claude/state/wiki/` |
| Бэкапы вики | Яндекс Диск → `claude-wiki-backup/` (7 последних); другая папка — `CLAUDE_WIKI_BACKUP_DIR` |
| Карта папок кода (project-map) | `~/.claude/hooks/project-map-build.mjs` → блоки КАРТА в `CLAUDE.md` папок |

**Что делается само, по расписанию** (launchd, `launchctl list | grep local.claude`):

| Задача | Когда | Что делает |
|---|---|---|
| `claude-os-audit` | вс 10:07 | прогоняет скилл `os-audit`, отчёт в `~/.claude/audits/` |
| `claude-mem-backup` | ежедневно 12:41 | sqlite-копия памяти в Google Drive, gzip, ротация 7 |
| `claude-version-check` | 1-го 10:17 | сверяет версии с `state/versions.expected.json`, пишет `state/version-drift.md` только при расхождении |
| `claude-mem-provider` | каждые 10 мин | держит память на подписке, уводит на OpenRouter при отказе и возвращает обратно |
| `claude-wiki` | каждые 2 ч | обновляет вики проектов из очереди, собирает новые (≤3 за прогон) |
| `claude-wiki-backup` | ежедневно 12:51 | архив вики на Яндекс Диск, ротация 7 |

Результаты приходят не в лог, а в начало следующей сессии: хук `os-audit-staleness.sh` печатает
строку, если аудит устарел или версии разошлись. Молчит — всё ровно.


# BACKTRACK — разбор промаха до починки

Когда агент промахнулся по собственному сетапу, исправлять нужно не ответ, а маршрут.

**Триггеры:**
- Не нашёл то, что в сетапе есть.
- Сказал «нет доступа» / «не могу», хотя доступ есть.
- Искал долго там, где ответ лежал в одном известном файле.
- Пошёл не тем каналом (встроенный поиск вместо Воронки, скилл `docx` вместо `anydoc`).

**Что делать — именно в этом порядке:**
1. **Не** говорить «впредь так не делай». Это не чинит ничего.
2. Заставить агента пройти по собственному следу: что он вызвал, где искал, почему не нашёл.
3. Получить от него **причину**, названную явно, и место, где следовало искать.
4. Только после этого — чинить: правило, маршрут в карте выше, описание скилла.
5. Если причина не разовая — строка в Applied Learning (превентивная) или в `LEARNED.md`
   (диагностическая).

Признание ошибки без названной причины — не backtrack. Причина — это то, что чинится.

# Applied Learning — превентивное

Здесь только то, что нужно знать **до** шага: деструктивное и тихо ломающееся. Симптома не
будет — будет ущерб. Диагностическое (симптом виден, причина ищется потом) → `~/.claude/LEARNED.md`.

Новая заметка: одна строка, до 15 слов, без объяснений. Сюда — если цена ошибки необратима
или сбой тихий. Иначе — в `LEARNED.md`.

- `brew uninstall` тянет autoremove. Снёс gemini-cli — утащил сам node. Сначала `brew uses --installed`.
- git commit в общем репо сметает индекс субагента; коммить через 'git commit -- <пути>'.
- Cursor snapshots с root=home: 241GB за час, refs=0 → мусор, сносить.
- bash не понимает кириллицу в именах переменных; `bash -n` это не ловит.
- `/usr/bin/python3` — заглушка Xcode (exit 69). Рабочий: `__PYTHON__`.
- ЧИТАТЬ .docx/.pptx/.xlsx/.pdf — только `anydoc`, не скиллы docx/pdf/xlsx: pandoc и pypdf не установлены.
- СОЗДАВАТЬ/править .docx и .xlsx — штатные скиллы: python-docx и openpyxl на месте.
- Забрал отчёт агента — сразу TaskStop. Сам он не умирает, копится в панели.
- Осиротевшие tmux `claude-swarm-<pid>` съедают pty → «fork failed: Device not configured». Жнец в SessionStart/End.
- Боевой perplexity-MCP — локальная сборка ~/.claude/mcp, не глобальный npm. Обновлять обе.
- PreCompact-лимитер дублирует нативную защиту от thrashing и глушит компакт. Не включать.
- Субагент переписывает тестовый файл целиком; удалённый тест не краснеет. Сверять `grep -c '@Test'`.
- Open WebUI на старте стирает `static/`; отделку класть в `frontend/static`.
- `claude -p` молча не пишет в любые `.claude/`; рабочую папку модели держать вне.
- Грабли дизайн-цикла (пробы, снимки, OpenRouter/fal, вёрстка) — в `~/.local/share/design-skills/LEARNED.md`, не сюда.
