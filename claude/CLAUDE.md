@RTK.md

# Confidence Rule

Do not make any changes until you have 95% confidence in what you need to build. Ask me follow-up questions until you reach that confidence.

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
