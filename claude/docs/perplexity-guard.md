# perplexity-guard — механика принуждения «Воронки»

Справка. Правило поведения живёт в `~/.claude/CLAUDE.md`, здесь — только устройство.

## Что делает

Hook `~/.claude/hooks/perplexity-guard.sh`, событие `PreToolUse`, матчер `WebSearch|WebFetch` и
`Bash`. Блокирует встроенный веб-поиск и публичный `curl`/`wget` для главного агента и
редиректит в `mcp__perplexity-mcp__perplexity_search_web`.

## Кого пропускает

Субагенты — по top-level полям hook-input `agent_id` / `agent_type`. Именованный агент (`name:` во
фронтматтере) шлёт только `agent_type`, без `agent_id`, поэтому guard проверяет **оба** поля.
Парсинг — через `jq`, не grep: grep ловит вложенные поля и даёт ложные пропуски.

## Что не покрывает

Другие MCP: context-mode, Exa, Firecrawl. Через них сеть доступна без ограничений.

## Локальные хосты

localhost, 127.x, 10.x, 192.168.x, 172.16–31.x — `curl` не блокируется.
Отдельно: curl на 127.0.0.1 перехватывает context-mode, локальную службу дёргать httpx из .venv.

## Журнал

Решения пишутся в `~/.claude/perplexity-guard.log`.

## Фолбэк при мёртвом Perplexity

```bash
touch ~/.claude/perplexity-guard.disabled   # 10-минутное окно встроенного поиска
rm ~/.claude/perplexity-guard.disabled      # вернуть, когда ожил
```

Воронка при этом не меняется — меняется только канал обнаружения.

## Сборка MCP

Боевой perplexity-MCP — локальная сборка в `~/.claude/mcp`, не глобальный npm. Обновлять обе.
