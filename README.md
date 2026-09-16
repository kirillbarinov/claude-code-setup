# Claude Code Setup

Полный сетап Claude Code: плагины, скиллы, агенты, хуки, MCP, CLI-утилиты и глобальные инструкции. Ставится одним скриптом.

## Что внутри

| Компонент | Что даёт |
|---|---|
| **GSD (get-shit-done)** | 60+ скиллов workflow-фреймворка: планирование фаз, исполнение, код-ревью, дебаг, roadmap (`/gsd:help`) |
| **Плагины (12)** | superpowers (дисциплина работы: TDD, brainstorming, systematic-debugging), skill-creator, frontend-design, impeccable (аудит качества UI), context-mode (экономия контекста), claude-mem (память между сессиями), pyright-lsp + typescript-lsp (языковые серверы: точная навигация и диагностика вместо grep), semgrep (статический анализ безопасности), sentry + sentry-cli (мониторинг ошибок прода), hookify (создание хуков-правил обычным языком) |
| **MCP** | perplexity-mcp (канал обнаружения для веб-поиска, нужен свой API-ключ), chrome-devtools (управление браузером), context7 (актуальные доки библиотек, без ключа); MCP плагинов context-mode и claude-mem приходят с плагинами |
| **Поиск «Воронка» v2** | Скилл `research` + агент `researcher` + валидатор отчётов: вопрос классифицируется (ФАКТ / ПРАКТИКА / ВЫБОР / СОСТОЯНИЕ), выбирается режим (quick / standard / wide), первоисточники открываются самостоятельно, ответ выдаётся формой Вывод / Обоснование / Кто не согласен / Не установлено / Покрытие |
| **Дизайн-стек** | Агенты `design-director` (полный цикл: направление → DESIGN.md → вёрстка → ассеты → проверка скриншотами) и `design-critic` (слепая критика — видит только скриншоты), ~135 дизайн-скиллов и утилиты `_tools` (скриншоты, контраст, QA, генерация ассетов). Ставится отдельным шагом, отключается `SKIP_DESIGN_STACK=1` |
| **Кастомные скиллы** | `research`, `archify` (валидируемые диаграммы архитектуры/workflow/sequence с экспортом PNG/SVG/WebM), `web-test` (браузерный smoke-тест через изолированный субагент), `source-finder` (откуда взялся факт), `grilling` (стресс-тест плана или решения), `youtube-search` |
| **Документ-скиллы** | `xlsx`, `docx`, `pptx`, `pdf` — чтение/создание/правка офисных файлов (официальные скиллы [anthropics/skills](https://github.com/anthropics/skills), ставятся install-скриптом вместе с Python-зависимостями) |
| **Кастомные агенты** | backend-engineer, frontend-engineer, security-auditor (QA через реальный браузер), documenter, web-test-runner, researcher, design-director, design-critic |
| **Команды** | `/team` — командный режим из нескольких агентов (+ вспомогательные скрипты `scripts/team-*` для tmux/iTerm-панелей) |
| **Хуки** | perplexity-guard (направляет весь веб-поиск в Perplexity MCP, субагенты пропускает) + его тест-сьют, rtk-rewrite (авто-проксирование команд через rtk), ultrathink-conditional, tmux-swarm-reaper (жнёт осиротевшие tmux-сессии `/team`), context-mode-cache-heal, validate-research-report.py |
| **Компакт** | Профиль автокомпакта с рабочим прекомпьютом — см. раздел [Компакт](#компакт) |
| **CLI** | `rtk` (Rust Token Killer — экономит 60–90% токенов на dev-командах), `ezycopy` (чистый Markdown из любого URL), `yt-dlp` |
| **CLAUDE.md / RTK.md** | Глобальные инструкции: правило 95% уверенности, Воронка v2, проактивные скиллы, субагенты, web-fetch через ezycopy, развилка диаграмм, раздел Applied Learning с накопленными граблями |
| **rules/** | Те же правила отдельными модульными файлами (`claude/rules/`) — можно подключать выборочно вместо полного CLAUDE.md, см. `claude/rules/README.md` |
| **statusline** | Кастомная статус-строка (GSD-статус, контекст, модель) |

## Требования

- [Claude Code](https://claude.com/claude-code)
- Node.js 22+ (проверено на 26; npm 12 требует Node `^22 || ^24 || >=26` — ветка 25 не поддерживается)
- Python 3.10+ (для документ-скиллов и `validate-research-report.py`)
- Git — инсталлятор клонирует чужие наборы дизайн-скиллов и документ-скиллы Anthropic
- **macOS**: Homebrew (для rtk и yt-dlp)
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
winget install yt-dlp.yt-dlp       # для скилла youtube-search (опционально)
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

Оба скрипта делают одно и то же:
1. Бэкапят твои текущие `settings.json`, `CLAUDE.md`, `RTK.md`, `statusline-command.sh` (в `*.bak-<дата>`).
2. Ставят GSD (`npx get-shit-done-cc install`) — скиллы, агенты и хуки фреймворка.
3. Копируют конфиги, кастомные хуки, скиллы, агентов и команды в `~/.claude/`.
4. Ставят документ-скиллы `xlsx`/`docx`/`pptx`/`pdf` из [anthropics/skills](https://github.com/anthropics/skills) и их Python-зависимости (openpyxl, pandas, python-docx, pypdf, pdfplumber, pymupdf, markitdown).
5. Разворачивают дизайн-стек: свои скиллы в `~/.local/share/design-skills`, чужие — клонами из апстримов, симлинки в `~/.claude/skills` по манифесту `design-skills/SYMLINKS.txt`.
6. Регистрируют MCP `chrome-devtools`, `context7` и `perplexity-mcp` (спросит твой `PERPLEXITY_API_KEY` — взять на https://www.perplexity.ai/settings/api; ключ никуда, кроме твоей локальной конфигурации, не попадает).
7. Ставят бинари для плагинов: `pyright`, `typescript-language-server` (+ вложенный TypeScript 5), `@sentry/cli` (npm), `semgrep` (brew/pip).
8. Ставят `rtk` через brew (только macOS/Linux); подсказывают, как поставить `ezycopy` и `yt-dlp`.

После этого запусти `claude` — он сам предложит установить плагины, перечисленные в `settings.json` (superpowers, skill-creator, frontend-design, pyright-lsp, typescript-lsp, semgrep, sentry, sentry-cli, hookify — из официального маркетплейса; context-mode, claude-mem и impeccable — из своих GitHub-маркетплейсов).

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
/plugin         # 12 плагинов установлены и включены
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
- Скилл `youtube-search` требует `yt-dlp`; скилл `web-test` использует MCP chrome-devtools и агента `web-test-runner`.
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
