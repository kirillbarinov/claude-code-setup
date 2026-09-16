#!/usr/bin/env bash
# Self-test дизайн-стека. Запускать перед работой, если что-то ведёт себя странно.
#   stack-check.sh          — всё, кроме платных вызовов
#   stack-check.sh --paid   — плюс проверка баланса OpenRouter (бесплатный GET)
T="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ok(){ echo "  ✓ $1"; }; bad(){ echo "  ✗ $1"; FAILED=$((FAILED+1)); }; FAILED=0

echo "Инструменты:"
for b in "$T/serve.sh" "$T/or.sh" "$T/optimize-assets.sh" "$T/contrast.mjs"; do
  [ -x "$b" ] && ok "$(basename "$b")" || bad "$(basename "$b") — нет или не executable"
done

echo "Окружение:"
PY=""; for p in /opt/homebrew/bin/python3 /usr/local/bin/python3; do [ -x "$p" ] && "$p" -c pass 2>/dev/null && PY="$p" && break; done
[ -n "$PY" ] && ok "python3: $PY ($("$PY" -V 2>&1))" || bad "рабочего python3 нет — serve.sh не поднимется"
command -v node >/dev/null && ok "node: $(node -v)" || bad "node не найден"
command -v cwebp >/dev/null && ok "cwebp (WebP)" || bad "cwebp нет — brew install webp"
command -v avifenc >/dev/null && ok "avifenc (AVIF)" || echo "  ~ avifenc нет — AVIF пропускается (brew install libavif)"

echo "Ключ:"
if [ -f ~/.claude/secrets.env ]; then
  # shellcheck disable=SC1090
  source ~/.claude/secrets.env
  if [ -n "${OPENROUTER_API_KEY:-}" ] && [ "$OPENROUTER_API_KEY" != PASTE_YOUR_KEY_HERE ]; then ok "OPENROUTER_API_KEY задан (значение не печатается)"
  else bad "OPENROUTER_API_KEY пуст — впиши в ~/.claude/secrets.env"; fi
  [ "$(/usr/bin/stat -f%Lp ~/.claude/secrets.env)" = 600 ] && ok "права secrets.env 600" || bad "права secrets.env не 600"
else bad "~/.claude/secrets.env нет"; fi

echo "Скиллы:"
for s in openrouter-images openrouter-video design-taste-frontend theme-factory; do
  [ -f ~/.claude/skills/"$s"/SKILL.md ] && ok "$s" || bad "$s — SKILL.md не читается"
done
CNT=$(ls ~/.claude/skills 2>/dev/null | wc -l | tr -d ' '); echo "  · всего скиллов: $CNT"

echo "Браузер (chrome-devtools MCP):"
PROF=~/.cache/chrome-devtools-mcp/chrome-profile
if [ -d "$PROF" ]; then
  if ls "$PROF"/Singleton* >/dev/null 2>&1; then
    if pgrep -f "chrome-devtools-mcp/chrome-profile" >/dev/null 2>&1; then
      ok "профиль занят живым Chrome — это нормально"
    else
      rm -f "$PROF"/Singleton*
      ok "снят протухший SingletonLock (процесса Chrome не было) — иначе MCP падает с «The browser is already running»"
    fi
  else ok "профиль чист"; fi
else echo "  · профиль ещё не создан — нормально до первого запуска"; fi

echo "Сервер (живой запуск):"
OUT="$("$T/serve.sh" /tmp 2>&1)" && {
  URL=$(echo "$OUT" | sed -n 's/^URL=//p'); PID=$(echo "$OUT" | sed -n 's/^PID=//p')
  ok "поднялся на $URL"; kill "$PID" 2>/dev/null && ok "остановлен"
} || bad "serve.sh не поднялся: $OUT"

if [ "${1:-}" = "--paid" ]; then
  echo "OpenRouter:"; B="$("$T/or.sh" credits 2>&1)"
  case "$B" in remaining=*) ok "$B";; *) bad "$B";; esac
fi

echo; [ "$FAILED" = 0 ] && echo "STACK_OK — всё на месте." || echo "STACK_ISSUES: $FAILED"
exit 0
