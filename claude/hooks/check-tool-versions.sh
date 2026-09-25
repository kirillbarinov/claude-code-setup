#!/bin/bash
# Сверяет реальные версии инструментов с заявленными в ~/.claude/state/versions.expected.json.
# Пишет отчёт о дрейфе только при расхождении. Не использует ИИ, квоту не тратит.
# Запускается launchd-задачей local.claude-version-check (раз в месяц).
set -uo pipefail

STATE="$HOME/.claude/state"
MANIFEST="$STATE/versions.expected.json"
REPORT="$STATE/version-drift.md"
PY=__PYTHON__

[ -f "$MANIFEST" ] || exit 0

ver_node()   { node -v 2>/dev/null | tr -d 'v'; }
ver_npm()    { npm -v 2>/dev/null; }
ver_python() { "$PY" -V 2>&1 | awk '{print $2}'; }
ver_claude() { claude --version 2>/dev/null | awk '{print $1}'; }
ver_rtk()    { rtk --version 2>/dev/null | awk '{print $2}'; }
ver_pplx()   { "$PY" -c "import json,glob;p=glob.glob('$HOME/.claude/mcp/perplexity-mcp/package.json');print(json.load(open(p[0]))['version'] if p else '')" 2>/dev/null; }

{
  echo "node|$(ver_node)"
  echo "npm|$(ver_npm)"
  echo "python|$(ver_python)"
  echo "claude|$(ver_claude)"
  echo "rtk|$(ver_rtk)"
  echo "perplexity-mcp|$(ver_pplx)"
} > "$STATE/.versions.actual"

"$PY" - "$MANIFEST" "$STATE/.versions.actual" "$REPORT" <<'PYEOF'
import json, sys, datetime, os
manifest, actual_f, report = sys.argv[1], sys.argv[2], sys.argv[3]
tools = json.load(open(manifest))["tools"]
actual = {}
for line in open(actual_f):
    k, _, v = line.strip().partition("|")
    actual[k] = v

drift, missing = [], []
for name, meta in tools.items():
    got, want = actual.get(name, ""), meta["expect"]
    if not got:
        missing.append((name, want, meta["claimed_in"]))
    elif not got.startswith(want):
        drift.append((name, want, got, meta["claimed_in"]))

if not drift and not missing:
    if os.path.exists(report):
        os.remove(report)
    raise SystemExit(0)

today = datetime.date.today().isoformat()
with open(report, "w") as f:
    f.write(f"# Дрейф версий — {today}\n\n")
    f.write("Факты в правилах разошлись с реальностью. Починить в двух местах:\n"
            "в указанном файле правил И в `~/.claude/state/versions.expected.json`.\n\n")
    if drift:
        f.write("## Разошлись\n\n| Инструмент | Заявлено | На диске | Где заявлено |\n|---|---|---|---|\n")
        for n, w, g, c in drift:
            f.write(f"| {n} | {w} | **{g}** | {c} |\n")
        f.write("\n")
    if missing:
        f.write("## Не найдены\n\n| Инструмент | Заявлено | Где заявлено |\n|---|---|---|\n")
        for n, w, c in missing:
            f.write(f"| {n} | {w} | {c} |\n")
print(f"drift={len(drift)} missing={len(missing)}")
PYEOF

rm -f "$STATE/.versions.actual"
exit 0
