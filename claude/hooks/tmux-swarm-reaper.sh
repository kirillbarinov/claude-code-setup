#!/bin/bash
# Убивает осиротевшие tmux-серверы FleetView (claude-swarm-<pid>), оставшиеся
# от завершившихся сессий Claude Code. Каждая такая панель держит pty;
# при исчерпании kern.tty.ptmx_max tmux падает с
#   "respawn pane failed: fork failed: Device not configured".
# Сокет именуется claude-swarm-${process.pid} — сирота определяется точно:
# процесса с этим PID больше нет (или это уже не claude).

LOG="$HOME/.claude/tmux-swarm-reaper.log"
UID_NUM=$(id -u)
SOCK_DIR="${TMUX_TMPDIR:-/tmp}/tmux-${UID_NUM}"
killed=0

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG"; }

is_live_claude() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null || return 1
  ps -o args= -p "$pid" 2>/dev/null | grep -q 'claude' || return 1
  return 0
}

reap() {
  local sock="$1" owner="$2"
  if is_live_claude "$owner"; then
    return
  fi
  tmux -L "$sock" kill-server 2>/dev/null
  rm -f "$SOCK_DIR/$sock" 2>/dev/null
  log "убит осиротевший сервер $sock (владелец pid $owner мёртв)"
  killed=$((killed + 1))
}

# Канал 1: живые процессы tmux -L claude-swarm-<pid>
while read -r sock; do
  [ -n "$sock" ] || continue
  reap "$sock" "${sock##claude-swarm-}"
done < <(ps -U "$UID_NUM" -o args= 2>/dev/null \
         | grep -oE 'claude-swarm-[0-9]+' | sort -u)

# Канал 2: сокеты без процесса (сервер уже мёртв, файл остался)
if [ -d "$SOCK_DIR" ]; then
  for f in "$SOCK_DIR"/claude-swarm-*; do
    [ -S "$f" ] || continue
    sock=$(basename "$f")
    reap "$sock" "${sock##claude-swarm-}"
  done
fi

[ "$killed" -gt 0 ] && log "итого освобождено серверов: $killed"
exit 0
