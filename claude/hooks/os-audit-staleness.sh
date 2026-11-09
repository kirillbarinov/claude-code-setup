#!/bin/bash
# SessionStart: доносит результаты фоновых задач обслуживания сетапа.
# Печатает не более трёх коротких строк в stdout (они попадают в контекст) или молчит.
# Никогда не падает с ненулевым кодом — иначе ломает старт сессии.

set -u
AUDIT_DIR="$HOME/.claude/audits"
STATE="$HOME/.claude/state"
MAX_AGE_DAYS=7

# 1. Свежесть аудита
latest=$(ls -1t "$AUDIT_DIR"/os-audit-*.md 2>/dev/null | head -1)
if [ -z "$latest" ]; then
  echo "Аудит сетапа ни разу не запускался. Скилл os-audit проверит ~/.claude на битые ссылки, протухшие факты и мусор (read-only)."
else
  mtime=$(stat -f %m "$latest" 2>/dev/null || echo 0)
  if [ "$mtime" -gt 0 ]; then
    age_days=$(( ( $(date +%s) - mtime ) / 86400 ))
    [ "$age_days" -ge "$MAX_AGE_DAYS" ] && \
      echo "Аудит сетапа устарел на ${age_days} дн. (последний: $(basename "$latest")). Стоит прогнать скилл os-audit."
  fi
fi

# 2. Дрейф версий — отчёт появляется, только когда факты разошлись с реальностью
if [ -f "$STATE/version-drift.md" ]; then
  n=$(grep -c '^| ' "$STATE/version-drift.md" 2>/dev/null || echo 0)
  echo "Версии инструментов разошлись с заявленными в правилах (~${n} строк). Разбор: ~/.claude/state/version-drift.md"
fi

# 3. Память claude-mem перестала писать — флаг ставит claude-mem-backup.sh
# Флаг снимается только следующим бэкапом (раз в сутки) — если запись уже ожила,
# снимаем сами, иначе тревога врёт до 24 ч (аудит 2026-11-09b, D3).
if [ -f "$STATE/memory-stalled.md" ] && [ -f "$HOME/.claude-mem/claude-mem.db" ]; then
  fresh=$(/usr/bin/sqlite3 "$HOME/.claude-mem/claude-mem.db" \
    "SELECT COUNT(*) FROM observations WHERE julianday(created_at) > julianday('now','-24 hours');" 2>/dev/null)
  [ "${fresh:-0}" -gt 0 ] 2>/dev/null && rm -f "$STATE/memory-stalled.md"
fi
if [ -f "$STATE/memory-stalled.md" ]; then
  when=$(grep -m1 'последняя запись:' "$STATE/memory-stalled.md" | sed 's/^- //')
  why=$(grep -m1 'причина:' "$STATE/memory-stalled.md" | sed 's/^- //')
  echo "claude-mem не запоминает — $when; $why. Разбор: ~/.claude/state/memory-stalled.md"
fi

# 4. Вики проектов — упавшие обновления и застрявшая очередь
__PYTHON__ "$HOME/.claude/wiki-engine/wiki_hook.py" health 2>/dev/null

exit 0
