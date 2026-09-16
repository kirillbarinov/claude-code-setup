#!/usr/bin/env bash
# Поднять статический сервер над каталогом. Обходит мёртвый /usr/bin/python3 (Xcode license).
# Использование: serve.sh [каталог] [порт]   → печатает URL и PID, работает в фоне.
set -euo pipefail
DIR="${1:-.}"; PORT="${2:-0}"

pick_python() {
  for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 "$(command -v python3 || true)"; do
    [ -n "$p" ] && [ -x "$p" ] || continue
    "$p" -c 'pass' >/dev/null 2>&1 && { echo "$p"; return 0; }
  done
  return 1
}

free_port() {
  for p in $(seq 8760 8799); do
    if ! /usr/sbin/lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then echo "$p"; return 0; fi
  done
  return 1
}

[ "$PORT" = "0" ] && PORT="$(free_port)"
PY="$(pick_python)" || { echo "SERVE_FAIL: рабочий python3 не найден" >&2; exit 1; }

cd "$DIR"
nohup "$PY" -m http.server "$PORT" --bind 127.0.0.1 >/tmp/design-serve-$PORT.log 2>&1 &
PID=$!
for _ in $(seq 1 30); do
  if /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "URL=http://127.0.0.1:$PORT/"; echo "PID=$PID"; echo "STOP=kill $PID"; exit 0
  fi
  sleep 0.2
done
echo "SERVE_FAIL: порт $PORT не открылся; лог /tmp/design-serve-$PORT.log" >&2
tail -5 "/tmp/design-serve-$PORT.log" >&2 || true
exit 1
