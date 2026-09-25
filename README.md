# Claude Code Setup

Полный сетап Claude Code: плагины, скиллы, агенты, хуки, MCP, CLI-утилиты и глобальные инструкции. Ставится одним скриптом.

## Что внутри

| Компонент | Что даёт |
|---|---|
| **GSD (get-shit-done)** | 60+ скиллов workflow-фреймворка: планирование фаз, исполнение, код-ревью, дебаг, roadmap (`/gsd:help`) |
| **Плагины (13)** | superpowers (дисциплина работы: TDD, brainstorming, systematic-debugging), skill-creator, frontend-design, impeccable (аудит качества UI), context-mode (экономия контекста), claude-mem (память между сессиями), pyright-lsp + typescript-lsp + jdtls-lsp (языковые серверы Python / TypeScript / Java: точная навигация и диагностика вместо grep), semgrep (статический анализ безопасности), sentry + sentry-cli (мониторинг ошибок прода), hookify (создание хуков-правил обычным языком) |
| **MCP** | perplexity-mcp (канал обнаружения для веб-поиска, нужен свой API-ключ), chrome-devtools (управление браузером), context7 (актуальные доки библиотек, без ключа); MCP плагинов context-mode и claude-mem приходят с плагинами |
| **Поиск «Воронка» v2** | Скилл `research` + агент `researcher` + валидатор отчётов: вопрос классифицируется (ФАКТ / ПРАКТИКА / ВЫБОР / СОСТОЯНИЕ), выбирается режим (quick / standard / wide), первоисточники открываются самостоятельно, ответ выдаётся формой Вывод / Обоснование / Кто не согласен / Не установлено / Покрытие |
| **Дизайн-стек** | Агенты `design-director` (полный цикл: направление → DESIGN.md → вёрстка → ассеты → проверка скриншотами) и `design-critic` (слепая критика — видит только скриншоты), ~135 дизайн-скиллов и утилиты `_tools` (скриншоты, контраст, QA, генерация ассетов). Ставится отдельным шагом, отключается `SKIP_DESIGN_STACK=1` |
| **Кастомные скиллы** | `research`, `archify` (валидируемые диаграммы архитектуры/workflow/sequence с экспортом PNG/SVG/WebM), `web-test` (браузерный smoke-тест через изолированный субагент), `wiki` (управление вики проектов), `os-audit` (самоаудит сетапа: битые ссылки, протухшие факты, мусор; read-only), `convert-documents-to-markdown` (офисные файлы и PDF в Markdown через anydoc), `grilling` / `grill-me` / `grill-with-docs` (стресс-тест плана или решения), `resolving-merge-conflicts` |
| **Документ-скиллы** | `xlsx`, `docx`, `pptx`, `pdf` — чтение/создание/правка офисных файлов (официальные скиллы [anthropics/skills](https://github.com/anthropics/skills), ставятся install-скриптом вместе с Python-зависимостями) |
| **Кастомные агенты** | backend-engineer, frontend-engineer, security-auditor (QA через реальный браузер), documenter, web-test-runner, researcher, design-director, design-critic |
| **Команды** | `/team` — командный режим из нескольких агентов (+ вспомогательные скрипты `scripts/team-*` для tmux/iTerm-панелей) |
| **Хуки** | perplexity-guard (направляет весь веб-поиск в Perplexity MCP, субагенты пропускает) + его тест-сьют, rtk-rewrite (авто-проксирование команд через rtk), ultrathink-conditional, tmux-swarm-reaper (жнёт осиротевшие tmux-сессии `/team`), context-mode-cache-heal, validate-research-report.py, project-map (карта папок кода в подкаталожных `CLAUDE.md`), os-audit-staleness (на старте сессии сообщает об устаревшем аудите, дрейфе версий, остановке памяти, сбоях вики), claude-mem-provider / claude-mem-model (сторож канала памяти: подписка основным, OpenRouter запасным), бэкапы памяти и вики |
| **Вики проектов** | Автоматическая база знаний по каждому проекту в `~/.claude/wiki/` (git): router проекта подгружается на старте сессии, страницы — по нужде. Пишется фоновой моделью из памяти claude-mem и git-истории, проверяется lint-ом, в вики не попадают секреты. Движок — `wiki-engine/` (python stdlib, 58 тестов). См. раздел [Вики проектов и фоновые задачи](#вики-проектов-и-фоновые-задачи) |
| **Компакт** | Профиль автокомпакта с рабочим прекомпьютом — см. раздел [Компакт](#компакт) |
| **CLI** | `rtk` (Rust Token Killer — экономит 60–90% токенов на dev-командах), `ezycopy` (чистый Markdown из любого URL), `anydoc` (офисные файлы и PDF в Markdown) |
| **CLAUDE.md / RTK.md / LEARNED.md** | Глобальные инструкции: правило 95% уверенности, Воронка v2, проактивные скиллы, субагенты, web-fetch через ezycopy, развилка диаграмм, вики проектов, карта расположения файлов сетапа, разбор промахов (BACKTRACK), превентивные грабли (Applied Learning); диагностические грабли — в `LEARNED.md` |
| **Переключатели модели** | `model-openrouter.sh` / `model-anthropic.sh` — перевести Claude Code на OpenRouter и вернуть обратно |
| **statusline** | Кастомная статус-строка (GSD-статус, контекст, модель) |

## Требования

- [Claude Code](https://claude.com/claude-code)
- Node.js 22+ (проверено на 26; npm 12 требует Node `^22 || ^24 || >=26` — ветка 25 не поддерживается)
- Python 3.10+ (для вики, хуков, документ-скиллов и `validate-research-report.py`); инсталлятор сам ищет рабочий (`/opt/homebrew`, `/usr/local`, `PATH`) и пропускает заглушку Xcode
- Git — инсталлятор клонирует чужие наборы дизайн-скиллов и документ-скиллы Anthropic
- **macOS**: Homebrew (для rtk и semgrep)
- **Windows**: Git for Windows (Git Bash — без него не работают bash-хуки); рекомендуется WSL

## Установка (macOS / Linux)

```bash
git clone https://github.com/kirillbarinov/claude-code-setup.git
cd claude-code-setup
bash install.sh
```

Без дизайн-стека (экономит ~350 МБ и пять клонов):

```bash
SKIP_DESIGN_STACK=1 bash install.sh
```

## Установка (Windows)

**Вариант 1 — WSL (рекомендуется).** Внутри WSL всё работает как на Linux:

```bash
git clone https://github.com/kirillbarinov/claude-code-setup.git
cd claude-code-setup
bash install.sh
```

**Вариант 2 — нативно, PowerShell.** Сначала поставь зависимости:

```powershell
winget install OpenJS.NodeJS.LTS   # Node.js
winget install Git.Git             # Git for Windows (даёт bash для хуков)
```

Затем:

```powershell
git clone https://github.com/kirillbarinov/claude-code-setup.git
cd claude-code-setup
powershell -ExecutionPolicy Bypass -File install.ps1
```

Особенности нативной Windows-установки:
- Хуки — bash-скрипты, исполняются через Git Bash (поэтому Git for Windows обязателен).
- `rtk` через brew недоступен — хук rtk-rewrite просто пропускает команды (всё работает, но без экономии токенов). См. https://www.rtk-ai.app/
- Дизайн-скиллы **копируются**, а не линкуются (симлинки на Windows требуют админ-прав), поэтому обновление — повторный запуск скрипта. Живут в `%LOCALAPPDATA%\design-skills`.
- Скрипты `claude/scripts/team-*` (osascript/tmux-панели для `/team`) — только macOS, не копируются.
- `"teammateMode": "tmux"` в settings.json на Windows без tmux можно убрать или поставить WSL с tmux.
- Хук `tmux-swarm-reaper.sh` без tmux просто ничего не делает.
- **Вики проектов и фоновые задачи (бэкапы, аудит, сверка версий, сторож канала памяти) — только macOS**: они держатся на launchd. На Windows движок вики не ставится, его хуки убираются из `settings.json`, скрипт пишет об этом при установке. Всё остальное работает.

Оба скрипта делают одно и то же:
1. Бэкапят твои текущие `settings.json`, `CLAUDE.md`, `RTK.md`, `statusline-command.sh` (в `*.bak-<дата>`).
2. Ставят GSD (`npx get-shit-done-cc install`) — скиллы, агенты и хуки фреймворка.
3. Копируют конфиги, кастомные хуки, скиллы, агентов и команды в `~/.claude/`.
4. Ставят документ-скиллы `xlsx`/`docx`/`pptx`/`pdf` из [anthropics/skills](https://github.com/anthropics/skills) и их Python-зависимости (openpyxl, pandas, python-docx, pypdf, pdfplumber, pymupdf, markitdown).
5. Разворачивают дизайн-стек: свои скиллы в `~/.local/share/design-skills`, чужие — клонами из апстримов, симлинки в `~/.claude/skills` по манифесту `design-skills/SYMLINKS.txt`.
6. Регистрируют MCP `chrome-devtools`, `context7` и `perplexity-mcp` (спросит твой `PERPLEXITY_API_KEY` — взять на https://www.perplexity.ai/settings/api; ключ никуда, кроме твоей локальной конфигурации, не попадает).
7. Ставят бинари для плагинов: `pyright`, `typescript-language-server` (+ вложенный TypeScript 5), `@sentry/cli` (npm), `semgrep` (brew/pip).
8. Ставят `rtk` через brew (только macOS/Linux) и `anydoc` через npm; подсказывают, как поставить `ezycopy`.
9. Удаляют устаревшее из прошлых версий сетапа (`source-finder`, `youtube-search`, `research-workflow.md`).

Только `install.sh`:

10. Ставят движок вики в `~/.claude/wiki-engine`, создают `~/.claude/wiki` (git) со списком исключений и `~/.claude/state`.
11. На macOS раскладывают шесть launchd-задач из шаблонов `claude/launchd/` (подставляются `$HOME`, найденный python и `PATH` с `claude`) и загружают их. Повторный запуск перезагружает задачи.
12. Создают `~/.claude/secrets.env` с пустым `OPENROUTER_API_KEY`, если файла нет (ключи в репозиторий не попадают).

После этого запусти `claude` — он сам предложит установить плагины, перечисленные в `settings.json` (superpowers, skill-creator, frontend-design, pyright-lsp, typescript-lsp, semgrep, sentry, sentry-cli, hookify — из официального маркетплейса; context-mode, claude-mem и impeccable — из своих GitHub-маркетплейсов).

## Вики проектов и фоновые задачи

**Вики.** Для каждого проекта (папка первого уровня в `~`) в `~/.claude/wiki/<проект>/` лежат `router.md` (до 2000 символов, подгружается хуком на старте сессии) и `pages/` (открываются по нужде). Конвейер: очередь (хук SessionEnd) → дельта из claude-mem и git → фоновый `claude -p` → lint (фронтматтер, лимиты, битые ссылки, секреты) → перенос → индекс `_index.md` → git-коммит. Упавший прогон не трогает живую вики. Исключить проект — строкой в `~/.claude/wiki/_exclude.txt`. Руками вики не правится: скилл `wiki` («обнови вики», «пересобери вики»). Дизайн — `docs/auto-wiki-design.md`.

**Фоновые задачи (macOS, launchd):**

| Задача | Когда | Что делает |
|---|---|---|
| `local.claude-wiki` | каждые 2 ч | обновляет вики из очереди, собирает новые (≤3 за прогон) |
| `local.claude-wiki-backup` | ежедневно 12:51 | архив вики, ротация 7 |
| `local.claude-mem-backup` | ежедневно 12:41 | sqlite-копия памяти claude-mem с проверкой целостности, gzip, ротация 7; ставит флаг, если память перестала писать |
| `local.claude-mem-provider` | каждые 10 мин | держит память на подписке, при отказе уводит на OpenRouter и возвращает обратно (нужен ключ) |
| `local.claude-os-audit` | вс 10:07 | прогоняет скилл `os-audit`, отчёт в `~/.claude/audits/` |
| `local.claude-version-check` | 1-го числа 10:17 | сверяет версии инструментов с `~/.claude/state/versions.expected.json` (если файл есть) |

Результаты приходят в начало следующей сессии строкой от хука `os-audit-staleness.sh`; молчит — всё в порядке.

**Куда уходят бэкапы.** Память — в корень первого смонтированного Google Drive (`claude-mem-backup/`), вики — в Яндекс Диск (`claude-wiki-backup/`), если он есть. Иначе обе — в `~/.claude/backups/`. Другая папка: ключ `CLAUDE_MEM_BACKUP_DIR` / `CLAUDE_WIKI_BACKUP_DIR` в `EnvironmentVariables` нужного plist в `~/Library/LaunchAgents`, затем `launchctl bootout gui/$(id -u)/<label>` и `launchctl bootstrap gui/$(id -u) <plist>`.

**Linux.** Движок и хуки вики ставятся, но расписания нет: `python3 ~/.claude/wiki-engine/wiki_update.py` вручную или по cron раз в 2 часа.

## Компакт

Автокомпакт настроен профилем `"autoCompactWindow": 253000` в `settings.json`. Это не косметика — от числа зависит, работает ли прекомпьют (фоновая подготовка сжатия, которая избавляет от паузы и от рваного шва в середине работы).

Как считается порог в текущем движке:

```
порог срабатывания компакта = autoCompactWindow − 33000
                              (резерв 20k + служебные 13k)
```

То есть при `253000` компакт стартует примерно на 220k токенов.

Два практических ограничения, из-за которых значение и подобрано:

- **`autoCompactWindow` меньше 200000 отключает прекомпьют.** В движке стоит гейт «окно < 200000 → прекомпьют не запускать» при явно заданном значении. Поставил 140000, чтобы компактиться чаще, — получил компакт без прекомпьюта, то есть с полной паузой.
- **Минимум с живым прекомпьютом — 167k** (`200000 − 33000`). Ниже опустить порог, сохранив прекомпьют, нельзя ничем, кроме патча бинарника. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` не помогает: итоговое значение берётся как `min(0.8 × окно, порог)`, и переменная схлопывается в тот же порог.

Отсюда рабочее правило: **не опускать `autoCompactWindow` ниже 200000**. Хочешь компактиться реже — поднимай число; хочешь чаще — упрёшься в 167k и дальше только ценой прекомпьюта.

Если у тебя окно модели меньше 253k, поставь значение по своему окну, но не ниже 200000:

```jsonc
// ~/.claude/settings.json
"autoCompactWindow": 253000
```

В этом же профиле выключен `PreCompact`-хук-лимитер, который стоял в прошлых версиях сетапа: он дублировал нативную защиту от thrashing и глушил компакт. Если он остался у тебя с прошлой установки — переименуй `~/.claude/hooks/compact-limiter.sh` и убери его запись из `settings.json` (инсталлятор перезаписывает `settings.json` целиком, так что запись уйдёт сама).

## Проверка

Внутри Claude Code:

```
/hooks          # хуки подхватились
/plugin         # 13 плагинов установлены и включены
/gsd:help       # GSD работает
/research       # Воронка v2 отвечает
/context        # видно окно и запас до компакта
```

В терминале:

```bash
claude mcp list                              # chrome-devtools, context7, perplexity-mcp
rtk gain                                     # аналитика экономии токенов
ezycopy --version
bash ~/.claude/hooks/perplexity-guard.test.sh  # 24 теста guard'а
ls ~/.claude/skills | wc -l                  # ~200 со всеми кластерами
launchctl list | grep local.claude          # шесть фоновых задач (macOS)
cd ~/.claude/wiki-engine && python3 -m unittest discover -s tests   # 58 тестов движка вики
```

## Заметки

- **Perplexity обязателен по дизайну сетапа**: хук `perplexity-guard.sh` блокирует встроенные `WebSearch`/`WebFetch` и публичный `curl`/`wget`, направляя весь поиск в Perplexity MCP. Субагенты guard пропускает по полям `agent_id`/`agent_type`. Если ключа нет — временно отключи guard (`touch ~/.claude/perplexity-guard.disabled`, окно 10 мин) или удали его записи из `settings.json`. Локальные хосты (localhost, 127.x, 10.x, 192.168.x, 172.16–31.x) не блокируются.
- Поиск идёт **не** сырым синтезом: скилл `research` требует открывать первоисточники, а для режима `wide` — прогонять вывод через «ломателя». Форму отчёта проверяет `hooks/validate-research-report.py` (запускается вручную, стоит бесплатно).
- `permissions.deny` в профиле держит только необратимое: `git push --force`, `rm -rf /`, `wget … | bash`. Обычный `git push` разрешён — если хочешь, чтобы агент не пушил сам, добавь `"Bash(git push*)"` в тот же список.
- `"skipDangerousModePermissionPrompt": true` — пропуск подтверждения при входе в опасный режим. Удобно, но это снятая страховка: **убери строку, если не уверен**.
- `"language": "Russian"` — Claude отвечает по-русски. Поменяй/убери под себя.
- Ключ `"model"` в профиле не задан — используется дефолт аккаунта. Добавь строку вида `"model": "claude-opus-5[1m]"`, если нужна конкретная модель с расширенным контекстом (требует соответствующей подписки).
- Хук `rtk-rewrite.sh` прозрачно оборачивает частые команды (`git status` и т.п.) в `rtk`. Нужен rtk 0.49+: в 0.29 были грабли с `grep`/`cat`/`npx`, обходившиеся через `rtk proxy` — больше не нужно.
- Хук `tmux-swarm-reaper.sh` (SessionStart/SessionEnd) убивает осиротевшие tmux-сессии `claude-swarm-<pid>` — иначе они съедают pty и следующий запуск падает с `fork failed: Device not configured`.
- Скилл `web-test` использует MCP chrome-devtools и агента `web-test-runner`.
- Читать `.docx`/`.pptx`/`.xlsx`/`.pdf` правила велят через `anydoc` (скилл `convert-documents-to-markdown`), создавать и править — штатными документ-скиллами.
- Документ-скиллы (`xlsx`/`docx`/`pptx`/`pdf`) для конвертаций форматов используют LibreOffice — опционально: `brew install --cask libreoffice`.
- Плагины `pyright-lsp`/`typescript-lsp` требуют бинари `pyright` и `typescript-language-server`. Важно: `typescript@7` — нативный Go-порт без `tsserver.js`, и `typescript-language-server` его не видит; инсталлятор ставит TypeScript 5 вложенной зависимостью внутрь tsls.
- `semgrep` в изолированном окружении `uv` может застрять на старом Python и не обновляться обычным `uv tool upgrade`. Лечится явно: `uv tool install semgrep --force --python 3.13`.
- `hookify` позволяет создавать собственные хуки-правила обычным языком: `/hookify <описание правила>`.
- Токен-диета GSD (опционально): редко используемые кластеры скиллов можно убрать из поверхности, перенеся их директории `~/.claude/skills/gsd-*` в соседнюю папку (например, `~/.claude/skills-disabled-gsd/`); возврат — обратный перенос + рестарт сессии.
- Обновление GSD: `/gsd:update` внутри Claude Code.

## Дизайн-стек

Ставится в `~/.local/share/design-skills`, в `~/.claude/skills` попадает симлинками (манифест — `design-skills/SYMLINKS.txt`, 135 записей).

- **Свои скиллы и утилиты** лежат в этом репозитории: `brandkit`, `canvas-design`, `openrouter-images`, `openrouter-video`, `theme-factory`, `taste-skill` и другие, плюс `_tools` — скриншоты (`shot.mjs`), QA-прогон вёрстки (`qa.mjs`), контраст, генерация ассетов (`or.sh`, `gen-image.sh`, `gen-video.sh`), локальный сервер.
- **Чужие наборы не вендорятся** — инсталлятор клонирует их из апстримов (лицензии остаются у авторов): [MengTo/Skills](https://github.com/MengTo/Skills), [ConardLi/garden-skills](https://github.com/ConardLi/garden-skills), [jakubkrehel/skills](https://github.com/jakubkrehel/skills), [emilkowalski/skills](https://github.com/emilkowalski/skills), [elayadesign/ai-design-skills](https://github.com/elayadesign/ai-design-skills).
- **Генерация ассетов** идёт через OpenRouter — нужен `OPENROUTER_API_KEY` в окружении (https://openrouter.ai/keys). Без ключа остальные дизайн-скиллы работают, генерация — нет.
- **Память цикла** — `~/.local/share/design-skills/LEARNED.md`: грабли конкретно дизайн-работы пишутся туда, а не в CLAUDE.md. При повторной установке твой файл сохраняется, версия из репозитория кладётся рядом как `LEARNED.md.bak-<дата>`.
- Пропустить установку: `SKIP_DESIGN_STACK=1 bash install.sh`.
