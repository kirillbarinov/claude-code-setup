#!/bin/bash
# Еженедельный самоаудит сетапа. Запускается launchd (local.claude-os-audit).
# Скилл os-audit read-only: отчёт кладёт этот скрипт в ~/.claude/audits/, сам скилл ничего не чинит.
#
# Почему с 27.09 по 08.11.2026 не появилось ни одного отчёта — и что здесь против этого:
#   - `claude -p` молча не пишет в .claude/ (прогоны 27.09, 04.10, 11.10 с rc=0 без файла)
#     → модель работает во временной папке и пишет ./report.md, переносит его скрипт;
#   - Mac уснул посреди прогона (18.10) → caffeinate -i;
#   - истёк или отключён вход CLI (01.11, 08.11) → токен из lib-unattended-auth.sh;
#   - при отказе скрипт отдавал exit 0, launchd видел успех → теперь exit 1 и строка «НЕТ ОТЧЁТА».
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin"
STATE="$HOME/.claude/state"; LOG="$STATE/os-audit.log"; AUDITS="$HOME/.claude/audits"
mkdir -p "$STATE" "$AUDITS"
. "$HOME/.claude/hooks/lib-unattended-auth.sh"
say() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

DAY=$(date +%F)
DEST=""
for s in "" b c d e f g; do
  [ -e "$AUDITS/os-audit-$DAY$s.md" ] || { DEST="$AUDITS/os-audit-$DAY$s.md"; break; }
done
[ -n "$DEST" ] || { say "за $DAY уже 7 отчётов, пропуск"; exit 0; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/os-audit.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

say "старт (вход: $AUTH_SOURCE)"
OUT=$(cd "$WORK" && caffeinate -i claude -p "Запусти скилл os-audit по всему сетапу в ~/.claude. Это плановый еженедельный прогон: только чтение и отчёт, ничего не чинить. Канала до человека нет — вопросы не задавать. Отчёт запиши ОДНИМ файлом ./report.md в текущей папке, а не в ~/.claude/audits: туда его перенесёт запускающий скрипт. В конце выведи одну строку: AUDIT=<число находок>." --output-format text 2>&1)
RC=$?
N=$(echo "$OUT" | grep -o 'AUDIT=[0-9]*' | tail -1)

if [ $RC -eq 0 ] && [ -s "$WORK/report.md" ]; then
  mv "$WORK/report.md" "$DEST"
  say "rc=0 $N отчёт: $DEST"
  exit 0
fi
say "rc=$RC $N НЕТ ОТЧЁТА"
echo "$OUT" | grep -v '^Permission allow rule' | tail -5 >> "$LOG"
exit 1
