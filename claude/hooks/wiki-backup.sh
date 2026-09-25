#!/bin/bash
# Ежедневный архив вики проектов на Яндекс Диск (или в папку из CLAUDE_WIKI_BACKUP_DIR). Запускается launchd local.claude-wiki-backup.
# Вики восстановима пересборкой, но пересборка стоит квоты и теряет курирование — поэтому бэкап.
set -uo pipefail
SRC="$HOME/.claude/wiki"
DEST="${CLAUDE_WIKI_BACKUP_DIR:-}"
[ -z "$DEST" ] && [ -d "$HOME/Yandex.Disk.localized" ] && DEST="$HOME/Yandex.Disk.localized/claude-wiki-backup"
DEST="${DEST:-$HOME/.claude/backups/claude-wiki}"
LOG="$HOME/.claude/state/wiki/backup.log"
KEEP=7
mkdir -p "$(dirname "$LOG")"
say() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }
[ -d "$SRC" ] || { say "нет $SRC"; exit 0; }
mkdir -p "$DEST" 2>/dev/null || { say "нет доступа к $DEST — Яндекс Диск не запущен?"; exit 0; }
OUT="$DEST/claude-wiki-$(date +%F).tar.gz"
if tar -czf "$OUT.part" -C "$HOME/.claude" wiki 2>>"$LOG" && mv "$OUT.part" "$OUT"; then
  say "ок: $(( $(stat -f%z "$OUT") / 1024 )) KB -> $(basename "$OUT")"
else
  rm -f "$OUT.part"; say "ОШИБКА: tar не отработал"
fi
ls -1t "$DEST"/claude-wiki-*.tar.gz 2>/dev/null | tail -n +$((KEEP+1)) | while read -r old; do
  rm -f "$old"; say "удалён старый: $(basename "$old")"
done
exit 0
