#!/bin/bash
# Вернуть Claude Code на Anthropic (откат).
set -e
S="$HOME/.claude/settings.json"
__PYTHON__ - "$S" << 'PY'
import json, sys
path = sys.argv[1]
d = json.load(open(path, encoding="utf-8"))
env = d.get("env", {})
for k in ("ANTHROPIC_BASE_URL","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_API_KEY",
          "ANTHROPIC_MODEL","ANTHROPIC_SMALL_FAST_MODEL",
          "ANTHROPIC_DEFAULT_OPUS_MODEL","ANTHROPIC_DEFAULT_SONNET_MODEL",
          "ANTHROPIC_DEFAULT_HAIKU_MODEL"):
    env.pop(k, None)
d["env"] = env
json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("→ Anthropic (переменные убраны)")
PY
echo "Дальше: выйди из claude, запусти заново. Если не пускает — /login внутри claude."
