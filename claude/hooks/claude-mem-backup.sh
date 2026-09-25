#!/bin/bash
# Бэкап памяти claude-mem в Google Drive (или в папку из CLAUDE_MEM_BACKUP_DIR). Единственная живая память сетапа —
# 888 сводок сессий и 7400+ наблюдений — существует в одном экземпляре без этого.
# sqlite3 .backup корректно снимает копию с БД, в которую пишут (в отличие от cp).
# Запускается launchd-задачей local.claude-mem-backup (ежедневно).
set -uo pipefail

DB="$HOME/.claude-mem/claude-mem.db"
# Куда класть: CLAUDE_MEM_BACKUP_DIR, иначе корень первого смонтированного Google Drive,
# иначе локальная папка (переживает сбой БД, но не сбой диска).
DEST="${CLAUDE_MEM_BACKUP_DIR:-}"
if [ -z "$DEST" ]; then
  for d in "$HOME"/Library/CloudStorage/GoogleDrive-*/"Мой диск" "$HOME"/Library/CloudStorage/GoogleDrive-*/"My Drive"; do
    [ -d "$d" ] && { DEST="$d/claude-mem-backup"; break; }
  done
fi
DEST="${DEST:-$HOME/.claude/backups/claude-mem}"
STATE="$HOME/.claude/state"
LOG="$STATE/claude-mem-backup.log"
KEEP=7
PY=__PYTHON__
TMP="${TMPDIR:-/tmp}/claude-mem-backup.$$.db"

mkdir -p "$STATE"
say() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

[ -f "$DB" ] || { say "БД не найдена: $DB"; exit 0; }
mkdir -p "$DEST" 2>/dev/null || { say "нет доступа к $DEST — Google Drive не смонтирован?"; exit 0; }

# 1. Снять копию
if ! /usr/bin/sqlite3 "$DB" ".backup '$TMP'" 2>>"$LOG"; then
  say "ОШИБКА: .backup не отработал"; rm -f "$TMP"; exit 0
fi

# 2. Проверить, что копия читаема — битый бэкап хуже отсутствующего
CHECK=$(/usr/bin/sqlite3 "$TMP" "PRAGMA integrity_check;" 2>/dev/null | head -1)
if [ "$CHECK" != "ok" ]; then
  say "ОШИБКА: копия не проходит integrity_check ($CHECK)"; rm -f "$TMP"; exit 0
fi
ROWS=$(/usr/bin/sqlite3 "$TMP" "SELECT COUNT(*) FROM observations;" 2>/dev/null || echo "?")

# 3. Сжать и положить рядом
OUT="$DEST/claude-mem-$(date +%F).db.gz"
/usr/bin/gzip -6 -c "$TMP" > "$OUT.part" && mv "$OUT.part" "$OUT"
rm -f "$TMP"
SIZE=$(/usr/bin/stat -f%z "$OUT" 2>/dev/null || echo 0)
say "ок: $(( SIZE / 1048576 )) MB, наблюдений $ROWS -> $(basename "$OUT")"

# 4. Простой памяти: бэкап живой ничего не значит, если БД перестала расти.
#    Флаг читает os-audit-staleness.sh и показывает в начале сессии.
STALL_FLAG="$HOME/.claude/state/memory-stalled.md"
STALL_HOURS=24
LAST=$(/usr/bin/sqlite3 "$DB" "SELECT MAX(created_at) FROM observations;" 2>/dev/null)
if [ -n "$LAST" ]; then
  AGE_H=$("$PY" -c "
import sys,datetime
t=sys.argv[1].replace('Z','+00:00')
d=datetime.datetime.fromisoformat(t)
now=datetime.datetime.now(d.tzinfo)
print(int((now-d).total_seconds()//3600))" "$LAST" 2>/dev/null || echo 0)
  if [ "${AGE_H:-0}" -ge "$STALL_HOURS" ]; then
    ERR=$("$PY" -c "
import json,os
p=os.path.expanduser('~/.claude-mem/observer-health.json')
try: h=json.load(open(p))
except Exception: h={}
print(h.get('lastErrorMessage','причина не записана'))" 2>/dev/null)
    {
      echo "# Память claude-mem не пишет"
      echo
      echo "- последняя запись: $LAST (${AGE_H} ч назад)"
      echo "- причина: $ERR"
      echo
      echo "Всё, что происходит в сессиях с этого момента, не запоминается."
      echo "Проверить \`~/.claude-mem/observer-health.json\` и \`quota-cooldown.json\`;"
      echo "Встать на запасную модель: \`~/.claude/hooks/claude-mem-model.sh backup\`"
      echo "(она проверяется живым запросом; неотвечающую скрипт не поставит)."
    } > "$STALL_FLAG"
    say "ВНИМАНИЕ: память не пишет ${AGE_H} ч ($ERR)"
  else
    rm -f "$STALL_FLAG"
  fi
fi

# 5. Ротация: держим последние $KEEP
ls -1t "$DEST"/claude-mem-*.db.gz 2>/dev/null | tail -n +$((KEEP+1)) | while read -r old; do
  rm -f "$old"; say "удалён старый: $(basename "$old")"
done
exit 0
