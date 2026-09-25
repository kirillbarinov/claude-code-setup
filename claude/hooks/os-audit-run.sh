#!/bin/bash
# Еженедельный самоаудит сетапа. Запускается launchd (local.claude-os-audit).
# Скилл os-audit read-only: он пишет отчёт в ~/.claude/audits/, но ничего не чинит.
set -uo pipefail
STATE="$HOME/.claude/state"; LOG="$STATE/os-audit.log"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
mkdir -p "$STATE" "$HOME/.claude/audits"
echo "[$(date '+%F %T')] старт" >> "$LOG"
OUT=$(cd "$HOME/.claude" && claude -p "Запусти скилл os-audit по всему сетапу в ~/.claude. Это плановый еженедельный прогон: только чтение и отчёт, ничего не чинить без спроса. Отчёт положи в ~/.claude/audits/os-audit-\$(date +%F).md. В конце выведи одну строку: AUDIT=<число находок>." --output-format text 2>&1)
RC=$?
echo "[$(date '+%F %T')] rc=$RC $(echo "$OUT" | grep -o 'AUDIT=[0-9]*' | tail -1)" >> "$LOG"
[ $RC -ne 0 ] && echo "$OUT" | tail -5 >> "$LOG"
exit 0
