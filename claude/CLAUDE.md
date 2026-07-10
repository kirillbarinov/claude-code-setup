@RTK.md

# Confidence Rule

Do not make any changes until you have 95% confidence in what you need to build. Ask me follow-up questions until you reach that confidence.

# Perplexity — единственный канал интернет-поиска (главный агент)

Любой поиск информации в интернете идёт ТОЛЬКО через `mcp__perplexity-mcp__perplexity_search_web`. Встроенный `WebSearch`/`WebFetch` не использовать; прямой `curl`/`wget` по публичному URL — тоже нет (guard их режет). Не отвечать «из головы», если вопрос требует данных из интернета (факты, свежие данные, специфические технические детали) — сначала искать в Perplexity.

**Выбор модели (экономия — по умолчанию `sonar`):**
- Прямой факт / один вопрос → `model="sonar"`, `max_tokens=1500`
- 2–3 угла / уточнения → несколько вызовов `sonar` (НЕ pro), каждый `max_tokens=1500`
- Research (много источников + синтез + citations) → один `model="sonar-pro"`, `max_tokens=1500–1800`, `temperature=0`
- Только сбор ссылок/citations → `model="sonar-pro"`, `max_tokens=400`, `temperature=0`

**Свежесть (`recency`, дефолт `month`):**
- Новости / цены / релизы / «сейчас» → `recency="day"` или `"week"`.
- Стабильные факты, доки, как-это-работает → дефолт `month` ок.
- Историческое / архив → `recency="year"`.

**Правила экономии:**
- НЕ брать `sonar-pro` без причины — его output дороже `sonar` в ~15× ($15 vs $1 за 1M).
- НЕ разгоняться на 5+ вызовов `sonar` по одному вопросу — тут уже один `sonar-pro` дешевле и чище (меньше per-request fee и меньше «простыней» в контексте Claude).
- `max_tokens` — это потолок (страховка от обрезки/разгона), не заказанная длина: платишь за фактически сгенерированное. На дешёвом `sonar` держи щедрым (~1500), на дорогом `sonar-pro` — умеренным. Технический максимум модели — 8192 токена, **наш жёсткий потолок — `max_tokens=2000`, не превышать**. Контекст: `sonar` 128K, `sonar-pro` 200K.

**Субагенты:** gsd-* и пр. guard НЕ трогает (свой research-инструментарий). Но субагентов, которых спавнишь сам под research, инструктируй в промпте: экономь веб-поиск, держи вывод коротким. Дисциплина экономии на них не распространяется автоматически.

**Результат Perplexity всегда обрабатывать и суммировать под вопрос — не вставлять сырой вывод.**

Открыть конкретный публичный URL — через `ezycopy <URL>` (см. Web Fetching Rules), не Perplexity. Локальные/приватные хосты (localhost, 127.x, 10.x, 192.168.x, 172.16–31.x) `curl`'ом не блокируются.

**Если Perplexity недоступен / ключ протух:** `touch ~/.claude/perplexity-guard.disabled` — откроется 10-мин окно, в котором встроенный поиск временно разрешён (фолбэк). Удали флаг, когда Perplexity снова жив.

> Принуждение: hook `perplexity-guard.sh` (`PreToolUse` на `WebSearch|WebFetch` и `Bash`) блокирует встроенный веб-поиск и публичный `curl`/`wget` для главного агента, редиректит в Perplexity. Субагенты пропускаются по top-level полю `agent_id` (парсинг `jq`, не grep — байпас через текст запроса закрыт). Решения пишутся в `~/.claude/perplexity-guard.log`. Другие MCP (context-mode и пр.) не покрываются — их веб-fetch не трогается.

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

# Subagents

Use subagents for any exploration or research. If a task needs 3+ files or multi-file analysis, spawn a subagent and return only summarized insights.

## Web Fetching Rules
When you need to read the contents of a webpage or documentation via URL, you are STRICTLY FORBIDDEN to use built-in web_fetch tools or browser MCPs.
Instead, always run the following command in the terminal: `ezycopy <URL>`.
Read the terminal output — it will be clean Markdown stripped of junk. Use it for your analysis.

# Applied Learning

When something fails repeatedly, when the user has to re-explain, or when a workaround is found for a platform/tool limitation, add a one-line bullet here. Keep each bullet under 15 words. No explanations. Only add things that will save time in future sessions.

- sudo -S + heredoc на ssh: пароль съедает первую строку. Пиши в /tmp без sudo, потом sudo cp.
