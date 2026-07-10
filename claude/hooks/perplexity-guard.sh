#!/usr/bin/env bash
# Perplexity Guard v2
# Заворачивает веб-доступ ГЛАВНОГО агента в Perplexity MCP.
# Покрытие: WebSearch|WebFetch + Bash(curl/wget на публичный http(s)).
# Субагенты (gsd-*, Explore, research) пропускаются по полю agent_id —
# их research-инструментарий не трогаем. Другие MCP не покрываются (by design).
#
# Различение «главный vs субагент» — по штатному top-level полю agent_id
# (присутствует только внутри субагента). Парсинг через jq (не grep по тексту),
# чтобы строка "agent_id" внутри запроса/URL не давала ложный пропуск.
#
# Фолбэк: если Perplexity недоступен/ключ протух — коснись флага
#   touch ~/.claude/perplexity-guard.disabled
# и в течение FALLBACK_TTL встроенный поиск временно разрешается.
#
# Лог решений: ~/.claude/perplexity-guard.log

LOG="$HOME/.claude/perplexity-guard.log"
FALLBACK_FLAG="$HOME/.claude/perplexity-guard.disabled"
FALLBACK_TTL=600   # сек — окно фолбэка после касания флага

JQ="$(command -v jq 2>/dev/null || true)"
[ -z "$JQ" ] && [ -x /opt/homebrew/bin/jq ] && JQ=/opt/homebrew/bin/jq

input=$(cat)

log() { printf '%s  %s\n' "$(date '+%FT%T')" "$*" >> "$LOG" 2>/dev/null || true; }
allow() { log "ALLOW $*"; exit 0; }   # пустой вывод = разрешить вызов

# --- извлечение полей ---
if [ -n "$JQ" ]; then
  tool=$(printf '%s' "$input"  | "$JQ" -r '.tool_name // empty'           2>/dev/null)
  agent=$(printf '%s' "$input" | "$JQ" -r '.agent_id // empty'            2>/dev/null)
  cmd=$(printf '%s' "$input"   | "$JQ" -r '.tool_input.command // empty'  2>/dev/null)
else
  log "WARN jq not found — degraded parse (fail-closed for main agent)"
  tool=$(printf '%s' "$input"  | grep -Eo '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/.*"([^"]*)"$/\1/')
  agent=$(printf '%s' "$input" | grep -Eo '"agent_id"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1)
  cmd=""
fi

# 1) Субагент -> пропустить (gsd/Explore/др. не трогаем)
if [ -n "$agent" ] && [ "$agent" != "null" ]; then
  allow "subagent ${tool}"
fi

# 2) Окно фолбэка: свежий флаг -> временно разрешаем встроенный путь
if [ -f "$FALLBACK_FLAG" ]; then
  now=$(date +%s)
  mt=$(stat -f %m "$FALLBACK_FLAG" 2>/dev/null || stat -c %Y "$FALLBACK_FLAG" 2>/dev/null || echo 0)
  if [ $(( now - mt )) -lt "$FALLBACK_TTL" ]; then
    allow "fallback-window ${tool}"
  fi
fi

# 3) Главный агент
case "$tool" in
  WebSearch|WebFetch)
    log "DENY main web-search ${tool}"
    cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Встроенный веб-поиск отключён для главного агента. Ищи через mcp__perplexity-mcp__perplexity_search_web: по умолчанию model=\"sonar\" (max_tokens 1500); research — один model=\"sonar-pro\", temperature=0, max_tokens 1500–1800; только ссылки — sonar-pro, max_tokens=400. ЖЁСТКИЙ ПОТОЛОК max_tokens=2000 — не превышать. Свежесть: recency=\"day\"/\"week\" для новостей/цен/релизов, иначе дефолт. Результат обрабатывай под вопрос, не вставляй сырьём. Конкретный URL открывай через `ezycopy <URL>`. Если Perplexity недоступен/ключ протух — `touch ~/.claude/perplexity-guard.disabled` (10-мин окно фолбэка) и повтори."}}
JSON
    exit 0
    ;;
  Bash)
    # перехват ТОЛЬКО curl/wget на ПУБЛИЧНЫЙ http(s); ezycopy и локальные/приватные хосты — мимо
    if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_/.-])(curl|wget)([[:space:]]|$)' \
       && ! printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_/.-])ezycopy([[:space:]]|$)'; then
      urls=$(printf '%s' "$cmd" | grep -Eoi "https?://[^[:space:]\"']+" 2>/dev/null || true)
      public=$(printf '%s' "$urls" | grep -Eiv '://(localhost|127\.|0\.0\.0\.0|\[?::1\]?|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' 2>/dev/null || true)
      if [ -n "$public" ]; then
        log "DENY main bash web-fetch"
        cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Прямой веб-fetch через curl/wget отключён для главного агента (обход Perplexity). Поиск — mcp__perplexity-mcp__perplexity_search_web (model=\"sonar\"). Открыть конкретную публичную страницу — `ezycopy <URL>`. Локальные/приватные хосты (localhost, 127.x, 10.x, 192.168.x, 172.16-31.x) и не-curl-инструменты не блокируются — это публичный URL, выбери Perplexity или ezycopy."}}
JSON
        exit 0
      fi
    fi
    allow "bash-ok"
    ;;
  *)
    allow "other ${tool}"
    ;;
esac
