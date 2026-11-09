#!/bin/bash
# Сторож агентов-напарников (teammateMode=tmux).
#
# Промах 2026-10-08: автообновление поставило 2.1.294 и удалило versions/2.1.291,
# а долгоживущая сессия запускает напарников по пути к СВОЕМУ бинарнику. Окно
# агента умирало сразу («env: …/2.1.291: No such file or directory», код 127),
# сессия этого не видела и два часа показывала агентов «работающими».
#
# Режимы:
#   ensure — если бинарник версии текущей сессии удалён, вернуть его ссылкой на
#            свежую версию (PreToolUse Agent, SessionStart, UserPromptSubmit).
#   check  — найти мёртвые окна агентов и окна с замершим экраном, сообщить
#            модели через additionalContext (PostToolUse Agent, UserPromptSubmit).
#   Аргумент 2 — имя события хука для JSON-ответа.

MODE="${1:-check}"
EVENT="${2:-UserPromptSubmit}"
VERS="$HOME/.local/share/claude/versions"
STATE="$HOME/.claude/state/agent-watchdog"
LOG="$HOME/.claude/agent-watchdog.log"
STALL_MIN=20
mkdir -p "$STATE"
cat >/dev/null 2>&1   # вход хука не нужен

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; }

# PID сессии Claude и путь её бинарника: идём вверх по родителям.
leader_pid=""; leader_bin=""
pid=$$
for _ in 1 2 3 4 5 6 7 8; do
  pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
  [ -n "$pid" ] && [ "$pid" -gt 1 ] || break
  bin=$(lsof -a -p "$pid" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | grep -m1 '/claude/versions/')
  if [ -n "$bin" ]; then leader_pid=$pid; leader_bin=$bin; break; fi
done
[ -n "$leader_pid" ] || exit 0

if [ "$MODE" = "ensure" ]; then
  if [ ! -e "$leader_bin" ]; then
    latest=$(ls -1 "$VERS" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
    if [ -n "$latest" ] && [ -x "$VERS/$latest" ]; then
      ln -sfn "$VERS/$latest" "$leader_bin" && log "восстановлен $leader_bin → $latest (сессия $leader_pid)"
    fi
  fi
  exit 0
fi

# check
SOCK="claude-swarm-$leader_pid"
tmux -L "$SOCK" list-panes -a -F '#{pane_id}|#{pane_dead}|#{pane_dead_status}|#{pane_title}' 2>/dev/null > "$STATE/panes.$$" || { rm -f "$STATE/panes.$$"; exit 0; }
seen="$STATE/reported.$leader_pid"
touch "$seen"
msgs=""
now=$(date +%s)
while IFS='|' read -r pane dead status title; do
  [ -n "$pane" ] || continue
  name="${title:-$pane}"
  if [ "$dead" = "1" ]; then
    key="dead $pane"
    grep -qxF "$key" "$seen" && continue
    tail_txt=$(tmux -L "$SOCK" capture-pane -p -t "$pane" 2>/dev/null | grep -v '^\s*$' | tail -3 | tr '\n' ' ' | cut -c1-200)
    msgs="$msgs\n- агент «$name» МЁРТВ (окно $pane, код $status): $tail_txt"
    echo "$key" >> "$seen"; log "мёртв $name ($pane, код $status)"
  else
    h=$(tmux -L "$SOCK" capture-pane -p -t "$pane" 2>/dev/null | md5 -q)
    f="$STATE/screen.$leader_pid.${pane#%}"
    if [ -f "$f" ] && [ "$(cut -d' ' -f1 "$f")" = "$h" ]; then
      since=$(cut -d' ' -f2 "$f")
      mins=$(( (now - since) / 60 ))
      key="stall $pane $since"
      if [ "$mins" -ge "$STALL_MIN" ] && ! grep -qxF "$key" "$seen"; then
        msgs="$msgs\n- агент «$name» не меняет экран $mins мин (окно $pane) — похоже, завис"
        echo "$key" >> "$seen"; log "замер $name ($pane) $mins мин"
      fi
    else
      echo "$h $now" > "$f"
    fi
  fi
done < "$STATE/panes.$$"
rm -f "$STATE/panes.$$"

[ -n "$msgs" ] || exit 0
text=$(printf 'СТОРОЖ АГЕНТОВ:%b\nДействие: TaskStop этого агента и перезапуск; владельцу сказать прямо. Не ждать отчёта от мёртвого агента.' "$msgs")
__PYTHON__ -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":sys.argv[1],"additionalContext":sys.argv[2]}}, ensure_ascii=False))' "$EVENT" "$text"
exit 0
