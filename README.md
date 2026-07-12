# Claude Code Setup

Полный сетап Claude Code: плагины, скиллы, агенты, хуки, MCP, CLI-утилиты и глобальные инструкции. Ставится одним скриптом.

## Что внутри

| Компонент | Что даёт |
|---|---|
| **GSD (get-shit-done)** | 60+ скиллов workflow-фреймворка: планирование фаз, исполнение, код-ревью, дебаг, roadmap (`/gsd:help`) |
| **Плагины (12)** | superpowers (дисциплина работы: TDD, brainstorming, systematic-debugging), skill-creator, frontend-design, impeccable (аудит качества UI), context-mode (экономия контекста), claude-mem (память между сессиями), pyright-lsp + typescript-lsp (языковые серверы: точная навигация и диагностика вместо grep), semgrep (статический анализ безопасности), sentry + sentry-cli (мониторинг ошибок прода), hookify (создание хуков-правил обычным языком) |
| **MCP** | perplexity-mcp (весь веб-поиск, нужен свой API-ключ), chrome-devtools (управление браузером), context7 (актуальные доки библиотек, без ключа); MCP плагинов context-mode и claude-mem приходят с плагинами |
| **Кастомные скиллы** | `web-test` (браузерный smoke-тест через изолированный субагент), `youtube-search` (поиск по YouTube через yt-dlp) |
| **Документ-скиллы** | `xlsx`, `docx`, `pptx`, `pdf` — чтение/создание/правка офисных файлов (официальные скиллы [anthropics/skills](https://github.com/anthropics/skills), ставятся install-скриптом вместе с Python-зависимостями) |
| **Кастомные агенты** | backend-engineer, frontend-engineer, security-auditor (QA через реальный браузер), documenter, web-test-runner |
| **Команды** | `/team` — командный режим из нескольких агентов (+ вспомогательные скрипты `scripts/team-*` для tmux/iTerm-панелей) |
| **Хуки** | perplexity-guard (принудительно направляет весь веб-поиск в Perplexity MCP), rtk-rewrite (авто-проксирование команд через rtk для экономии токенов), ultrathink-conditional, compact-limiter, context-mode-cache-heal |
| **CLI** | `rtk` (Rust Token Killer — экономит 60–90% токенов на dev-командах), `ezycopy` (чистый Markdown из любого URL), `yt-dlp` |
| **CLAUDE.md / RTK.md** | Глобальные инструкции: правило 95% уверенности, проактивные скиллы, субагенты для рисёрча, web-fetch через ezycopy |
| **rules/** | Те же правила отдельными модульными файлами (`claude/rules/`) — можно подключать выборочно вместо полного CLAUDE.md, см. `claude/rules/README.md` |
| **statusline** | Кастомная статус-строка (GSD-статус, контекст, модель) |

## Требования

- [Claude Code](https://claude.com/claude-code)
- Node.js 18+
- **macOS**: Homebrew (для rtk и yt-dlp)
- **Windows**: Git for Windows (Git Bash — без него не работают bash-хуки); рекомендуется WSL

## Установка (macOS / Linux)

```bash
git clone https://github.com/kirillbarinov/claude-code-setup.git
cd claude-code-setup
bash install.sh
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
- Скрипты `claude/scripts/team-*` (osascript/tmux-панели для `/team`) — только macOS, не копируются.
- `"teammateMode": "tmux"` в settings.json на Windows без tmux можно убрать или поставить WSL с tmux.

Оба скрипта делают одно и то же:
1. Бэкапят твои текущие `settings.json`, `CLAUDE.md`, `RTK.md`, `statusline-command.sh` (в `*.bak-<дата>`).
2. Ставит GSD (`npx get-shit-done-cc install`) — скиллы, агенты и хуки фреймворка.
3. Копирует конфиги, кастомные хуки, скиллы, агентов и команды в `~/.claude/`.
4. Ставит документ-скиллы `xlsx`/`docx`/`pptx`/`pdf` из [anthropics/skills](https://github.com/anthropics/skills) и их Python-зависимости (openpyxl, pandas, python-docx, pypdf, pdfplumber, pymupdf, markitdown).
5. Регистрирует MCP `chrome-devtools`, `context7` и `perplexity-mcp` (спросит твой `PERPLEXITY_API_KEY` — взять на https://www.perplexity.ai/settings/api; ключ никуда, кроме твоей локальной конфигурации, не попадает).
6. Ставит бинари для плагинов: `pyright`, `typescript-language-server` (npm), `@sentry/cli` (npm), `semgrep` (brew/pip).
7. Ставит `rtk` через brew (только macOS/Linux); подсказывает, как поставить `ezycopy` и `yt-dlp`.

После этого запусти `claude` — он сам предложит установить плагины, перечисленные в `settings.json` (superpowers, skill-creator, frontend-design, pyright-lsp, typescript-lsp, semgrep, sentry, sentry-cli, hookify — из официального маркетплейса; context-mode, claude-mem и impeccable — из своих GitHub-маркетплейсов).

## Проверка

Внутри Claude Code:

```
/hooks          # хуки подхватились
/plugin         # 12 плагинов установлены и включены
/gsd:help       # GSD работает
```

В терминале:

```bash
claude mcp list   # chrome-devtools, context7, perplexity-mcp
rtk gain          # аналитика экономии токенов
ezycopy --version
```

## Заметки

- **Perplexity обязателен по дизайну сетапа**: хук `perplexity-guard.sh` блокирует встроенные `WebSearch`/`WebFetch` и публичный `curl`/`wget`, направляя весь поиск в Perplexity MCP. Если ключа нет — временно отключи guard (`touch ~/.claude/perplexity-guard.disabled`, окно 10 мин) или удали его записи из `settings.json`.
- `settings.json` содержит `"permissions.deny": ["Bash(git push*)"]` — защита от случайного пуша агентом. Пуш делается руками или через `gh`. Убери, если не нужно.
- `"language": "Russian"` — Claude отвечает по-русски. Поменяй/убери под себя.
- `"model": "claude-fable-5[1m]"` — модель по умолчанию с контекстом 1M. Требует соответствующей подписки; убери строку, чтобы использовать дефолт.
- Хук `rtk-rewrite.sh` прозрачно оборачивает частые команды (`git status` и т.п.) в `rtk` — если rtk не установлен, хук просто пропускает.
- Скилл `youtube-search` требует `yt-dlp`; скилл `web-test` использует MCP chrome-devtools и агента `web-test-runner`.
- Документ-скиллы (`xlsx`/`docx`/`pptx`/`pdf`) для конвертаций форматов используют LibreOffice — опционально: `brew install --cask libreoffice`.
- Плагины `pyright-lsp`/`typescript-lsp` требуют бинари `pyright` и `typescript-language-server` (ставятся install-скриптом через npm); `semgrep` — одноимённый CLI; `sentry`/`sentry-cli` — аккаунт Sentry (OAuth при первом использовании).
- `hookify` позволяет создавать собственные хуки-правила обычным языком: `/hookify <описание правила>`.
- Токен-диета GSD (опционально): редко используемые кластеры скиллов можно убрать из поверхности, перенеся их директории `~/.claude/skills/gsd-*` в соседнюю папку (например, `~/.claude/skills-disabled-gsd/`); возврат — обратный перенос + рестарт сессии.
- Обновление GSD: `/gsd:update` внутри Claude Code.
