# Claude Code Setup

Полный сетап Claude Code: плагины, скиллы, агенты, хуки, MCP, CLI-утилиты и глобальные инструкции. Ставится одним скриптом.

## Что внутри

| Компонент | Что даёт |
|---|---|
| **GSD (get-shit-done)** | 60+ скиллов workflow-фреймворка: планирование фаз, исполнение, код-ревью, дебаг, roadmap (`/gsd:help`) |
| **Плагины** | superpowers (дисциплина работы: TDD, brainstorming, systematic-debugging), skill-creator, frontend-design, context-mode (экономия контекста), claude-mem (память между сессиями) |
| **MCP** | perplexity-mcp (весь веб-поиск, нужен свой API-ключ), chrome-devtools (управление браузером), context7 (актуальные доки библиотек, без ключа); MCP плагинов context-mode и claude-mem приходят с плагинами |
| **Кастомные скиллы** | `web-test` (браузерный smoke-тест через изолированный субагент), `youtube-search` (поиск по YouTube через yt-dlp), `source-finder` (поиск источников: Perplexity + NotebookLM Deep Research) |
| **Кастомные агенты** | backend-engineer, frontend-engineer, security-auditor (QA через реальный браузер), documenter, web-test-runner |
| **Команды** | `/team` — командный режим из нескольких агентов (+ вспомогательные скрипты `scripts/team-*` для tmux/iTerm-панелей) |
| **Хуки** | perplexity-guard (принудительно направляет весь веб-поиск в Perplexity MCP), rtk-rewrite (авто-проксирование команд через rtk для экономии токенов), ultrathink-conditional, compact-limiter, context-mode-cache-heal |
| **Research-воркфлоу** | `research-workflow.md` — алгоритм наполнения NotebookLM-ноутбуков исследованиями |
| **CLI** | `rtk` (Rust Token Killer — экономит 60–90% токенов на dev-командах), `ezycopy` (чистый Markdown из любого URL), `yt-dlp` |
| **CLAUDE.md / RTK.md** | Глобальные инструкции: правило 95% уверенности, проактивные скиллы, субагенты для рисёрча, web-fetch через ezycopy |
| **statusline** | Кастомная статус-строка (GSD-статус, контекст, модель) |

## Требования

- macOS (пути и Homebrew; на Linux — поправить установку CLI-утилит)
- [Claude Code](https://claude.com/claude-code)
- Node.js 18+ (`brew install node`)
- Homebrew (для rtk и yt-dlp)

## Установка

```bash
git clone https://github.com/kirillbarinov/claude-code-setup.git
cd claude-code-setup
bash install.sh
```

Скрипт:
1. Бэкапит твои текущие `settings.json`, `CLAUDE.md`, `RTK.md`, `statusline-command.sh` (в `*.bak-<дата>`).
2. Ставит GSD (`npx get-shit-done-cc install`) — скиллы, агенты и хуки фреймворка.
3. Копирует конфиги, кастомные хуки, скиллы, агентов и команды в `~/.claude/`.
4. Регистрирует MCP `chrome-devtools`, `context7` и `perplexity-mcp` (спросит твой `PERPLEXITY_API_KEY` — взять на https://www.perplexity.ai/settings/api; ключ никуда, кроме твоей локальной конфигурации, не попадает).
5. Ставит `rtk` через brew; подсказывает, как поставить `ezycopy` и `yt-dlp`.

После этого запусти `claude` — он сам предложит установить плагины, перечисленные в `settings.json` (superpowers, skill-creator, frontend-design — из официального маркетплейса; context-mode и claude-mem — из своих GitHub-маркетплейсов).

## Проверка

Внутри Claude Code:

```
/hooks          # хуки подхватились
/plugin         # 5 плагинов установлены и включены
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
- В скилле `source-finder` замени плейсхолдеры на UUID своих NotebookLM-ноутбуков (нужен NotebookLM MCP).
- `settings.json` содержит `"permissions.deny": ["Bash(git push*)"]` — защита от случайного пуша агентом. Пуш делается руками или через `gh`. Убери, если не нужно.
- `"language": "Russian"` — Claude отвечает по-русски. Поменяй/убери под себя.
- `"model": "claude-fable-5[1m]"` — модель по умолчанию с контекстом 1M. Требует соответствующей подписки; убери строку, чтобы использовать дефолт.
- Хук `rtk-rewrite.sh` прозрачно оборачивает частые команды (`git status` и т.п.) в `rtk` — если rtk не установлен, хук просто пропускает.
- Скилл `youtube-search` требует `yt-dlp`; скилл `web-test` использует MCP chrome-devtools и агента `web-test-runner`.
- Обновление GSD: `/gsd:update` внутри Claude Code.
