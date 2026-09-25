#!/bin/bash
# Переключить Claude Code на OpenRouter (глобально).
# Использование: model-openrouter.sh [ключ] [модель]
#   первый раз:  ./model-openrouter.sh sk-or-xxxxx z-ai/glm-4.6
#   потом:       ./model-openrouter.sh          (ключ и модель запомнены)
set -e
S="$HOME/.claude/settings.json"
K="$HOME/.claude/.openrouter-key"
M="$HOME/.claude/.openrouter-model"

[ -n "$1" ] && printf '%s' "$1" > "$K" && chmod 600 "$K"
[ -n "$2" ] && printf '%s' "$2" > "$M"
[ -f "$K" ] || { echo "Нет ключа. Запусти: $0 sk-or-ТВОЙ-КЛЮЧ"; exit 1; }
[ -f "$M" ] || printf 'z-ai/glm-4.6' > "$M"

[ -f "$S.anthropic-backup" ] || cp "$S" "$S.anthropic-backup"

__PYTHON__ - "$S" "$(cat "$K")" "$(cat "$M")" << 'PY'
import json, sys
path, key, model = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(path, encoding="utf-8"))
d.setdefault("env", {}).update({
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
    "ANTHROPIC_AUTH_TOKEN": key,
    "ANTHROPIC_API_KEY": "",
    "ANTHROPIC_MODEL": model,
    "ANTHROPIC_SMALL_FAST_MODEL": model,
})
json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("→ OpenRouter, модель:", model)
PY
echo "Дальше: выйди из claude, запусти заново. Если ругается на авторизацию — /logout внутри claude, потом перезапуск."
