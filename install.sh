#!/usr/bin/env bash
# Установка сетапа Claude Code.
# Порядок важен: сначала GSD (кладёт свои скиллы/хуки), потом этот скрипт.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
TS="$(date +%Y%m%d-%H%M%S)"

echo "==> Claude Code setup installer"

command -v claude >/dev/null || {
  echo "❌ claude не найден. Сначала установи Claude Code: https://claude.com/claude-code"
  exit 1
}
command -v node >/dev/null || {
  echo "❌ node не найден. Установи Node.js (brew install node)."
  exit 1
}

mkdir -p "$CLAUDE_DIR"/{hooks,skills,agents,commands,scripts}

# --- Бэкап существующих конфигов ---
for f in settings.json CLAUDE.md RTK.md statusline-command.sh; do
  if [ -f "$CLAUDE_DIR/$f" ]; then
    cp "$CLAUDE_DIR/$f" "$CLAUDE_DIR/$f.bak-$TS"
    echo "   бэкап: $CLAUDE_DIR/$f.bak-$TS"
  fi
done

# --- GSD (get-shit-done): 60+ скиллов, агенты, хуки ---
if [ ! -d "$CLAUDE_DIR/get-shit-done" ]; then
  echo "==> Устанавливаю GSD (get-shit-done-cc)..."
  npx -y get-shit-done-cc@latest install
else
  echo "   GSD уже установлен, пропускаю (обновление: /gsd:update внутри Claude Code)"
fi

# --- Файлы из репозитория ---
echo "==> Копирую конфиги, хуки, скиллы, агентов..."
cp "$REPO_DIR"/claude/CLAUDE.md "$CLAUDE_DIR/"
cp "$REPO_DIR"/claude/RTK.md "$CLAUDE_DIR/"
cp "$REPO_DIR"/claude/statusline-command.sh "$CLAUDE_DIR/"
cp -R "$REPO_DIR"/claude/hooks/. "$CLAUDE_DIR/hooks/"
cp "$REPO_DIR"/claude/research-workflow.md "$CLAUDE_DIR/" 2>/dev/null || true
for s in "$REPO_DIR"/claude/skills/*/; do
  name="$(basename "$s")"
  rm -rf "${CLAUDE_DIR:?}/skills/$name"
  cp -R "$s" "$CLAUDE_DIR/skills/"
done

# --- Документ-скиллы Anthropic: xlsx, docx, pptx, pdf (github.com/anthropics/skills) ---
if [ ! -d "$CLAUDE_DIR/skills/xlsx" ]; then
  echo "==> Ставлю документ-скиллы Anthropic (xlsx, docx, pptx, pdf)..."
  TMP_SKILLS="$(mktemp -d)"
  if git clone --depth 1 https://github.com/anthropics/skills "$TMP_SKILLS/anthropic-skills" >/dev/null 2>&1; then
    for s in xlsx docx pptx pdf; do
      cp -R "$TMP_SKILLS/anthropic-skills/skills/$s" "$CLAUDE_DIR/skills/"
    done
    echo "   xlsx, docx, pptx, pdf установлены."
  else
    echo "   ⚠️  Не удалось клонировать anthropics/skills — поставь позже вручную."
  fi
  rm -rf "$TMP_SKILLS"
fi

# Python-зависимости документ-скиллов (LibreOffice для конвертаций — опционально: brew install --cask libreoffice)
echo "==> Python-зависимости документ-скиллов..."
python3 -m pip install --quiet openpyxl pandas python-docx pypdf pdfplumber pymupdf markitdown 2>/dev/null \
  || echo "   ⚠️  pip не отработал — поставь вручную: python3 -m pip install openpyxl pandas python-docx pypdf pdfplumber pymupdf markitdown"
cp "$REPO_DIR"/claude/agents/*.md "$CLAUDE_DIR/agents/"
cp "$REPO_DIR"/claude/commands/*.md "$CLAUDE_DIR/commands/"
cp "$REPO_DIR"/claude/scripts/* "$CLAUDE_DIR/scripts/"
chmod +x "$CLAUDE_DIR"/hooks/*.sh "$CLAUDE_DIR/statusline-command.sh" "$CLAUDE_DIR"/scripts/*.sh

# settings.json: подставляем реальный $HOME вместо плейсхолдера
sed "s|__HOME__|$HOME|g" "$REPO_DIR/claude/settings.json" > "$CLAUDE_DIR/settings.json"
echo "   settings.json установлен (старый — в бэкапе)"

# --- Дизайн-стек: агенты design-director/design-critic + ~135 скиллов ---
# Свои скиллы живут в ~/.local/share/design-skills, чужие подтягиваются из апстримов,
# в ~/.claude/skills раскладываются симлинками по манифесту design-skills/SYMLINKS.txt.
DESIGN_DIR="$HOME/.local/share/design-skills"
if [ "${SKIP_DESIGN_STACK:-0}" != "1" ]; then
  echo "==> Дизайн-стек (~135 скиллов)..."
  mkdir -p "$DESIGN_DIR/_vendor"
  # свои скиллы и утилиты; личную память цикла (LEARNED.md) не затираем
  LEARNED_BAK=""
  if [ -f "$DESIGN_DIR/LEARNED.md" ]; then
    LEARNED_BAK="$DESIGN_DIR/LEARNED.md.bak-$TS"
    cp "$DESIGN_DIR/LEARNED.md" "$LEARNED_BAK"
  fi
  cp -R "$REPO_DIR"/design-skills/. "$DESIGN_DIR/"
  if [ -n "$LEARNED_BAK" ]; then
    cp "$LEARNED_BAK" "$DESIGN_DIR/LEARNED.md"
    echo "   LEARNED.md сохранён (копия из репозитория — в $LEARNED_BAK)"
  fi
  chmod +x "$DESIGN_DIR"/_tools/*.sh "$DESIGN_DIR"/_tools/*.mjs 2>/dev/null || true

  # чужие наборы скиллов — клонируются из апстримов, в этот репозиторий не вендорятся
  while IFS='|' read -r dir url; do
    [ -z "$dir" ] && continue
    if [ -d "$DESIGN_DIR/_vendor/$dir/.git" ]; then
      git -C "$DESIGN_DIR/_vendor/$dir" pull --quiet --ff-only 2>/dev/null || true
    else
      echo "   клонирую $dir..."
      git clone --depth 1 --quiet "$url" "$DESIGN_DIR/_vendor/$dir" 2>/dev/null \
        || echo "   ⚠️  не удалось склонировать $url — часть дизайн-скиллов не появится"
    fi
  done <<'VENDORS'
ConardLi-garden-skills|https://github.com/ConardLi/garden-skills.git
elayadesign-ai-design-skills|https://github.com/elayadesign/ai-design-skills.git
emilkowalski-skills|https://github.com/emilkowalski/skills.git
jakubkrehel-skills|https://github.com/jakubkrehel/skills.git
MengTo-Skills|https://github.com/MengTo/Skills.git
VENDORS

  # симлинки в ~/.claude/skills
  LINKED=0; MISSING=0
  while IFS='|' read -r name target; do
    [ -z "$name" ] && continue
    if [ -e "$DESIGN_DIR/$target" ]; then
      rm -rf "${CLAUDE_DIR:?}/skills/$name"
      ln -s "$DESIGN_DIR/$target" "$CLAUDE_DIR/skills/$name"
      LINKED=$((LINKED+1))
    else
      MISSING=$((MISSING+1))
    fi
  done < "$REPO_DIR/design-skills/SYMLINKS.txt"
  echo "   подключено скиллов: $LINKED (не найдено: $MISSING)"

  # зависимости скилла openrouter-images (генерация ассетов)
  if [ -d "$DESIGN_DIR/openrouter-images/scripts" ] && [ ! -d "$DESIGN_DIR/openrouter-images/scripts/node_modules" ]; then
    (cd "$DESIGN_DIR/openrouter-images/scripts" && npm install --silent 2>/dev/null) \
      || echo "   ⚠️  npm install для openrouter-images не отработал"
  fi
  echo "   ⚠️  Генерация ассетов требует OPENROUTER_API_KEY в окружении (https://openrouter.ai/keys)."
else
  echo "   дизайн-стек пропущен (SKIP_DESIGN_STACK=1)"
fi

# --- MCP: chrome-devtools ---
if ! claude mcp list 2>/dev/null | grep -q chrome-devtools; then
  echo "==> Регистрирую MCP chrome-devtools..."
  claude mcp add -s user chrome-devtools -- npx -y chrome-devtools-mcp@latest
fi

# --- MCP: context7 (актуальные доки библиотек, ключ не нужен) ---
if ! claude mcp list 2>/dev/null | grep -q context7; then
  echo "==> Регистрирую MCP context7..."
  claude mcp add -s user context7 -- npx -y @upstash/context7-mcp@latest
fi

# --- MCP: perplexity (нужен свой API-ключ: https://www.perplexity.ai/settings/api) ---
if ! claude mcp list 2>/dev/null | grep -q perplexity-mcp; then
  echo ""
  echo "==> Perplexity MCP — весь веб-поиск идёт через него (hook блокирует встроенный)."
  read -r -p "   Введи PERPLEXITY_API_KEY (Enter — пропустить): " PPLX_KEY
  if [ -n "${PPLX_KEY:-}" ]; then
    claude mcp add -s user perplexity-mcp -e PERPLEXITY_API_KEY="$PPLX_KEY" -- npx -y @jschuller/perplexity-mcp
    echo "   perplexity-mcp зарегистрирован."
  else
    echo "   ⚠️  Пропущено. Без ключа perplexity-guard будет блокировать веб-поиск —"
    echo "      либо добавь MCP позже: claude mcp add -s user perplexity-mcp -e PERPLEXITY_API_KEY=<ключ> -- npx -y @jschuller/perplexity-mcp"
    echo "      либо отключи guard: touch ~/.claude/perplexity-guard.disabled (10-мин окно) или убери его из settings.json"
  fi
fi

# --- Бинари для плагинов: LSP-серверы, sentry-cli, semgrep ---
echo "==> Бинари для плагинов (pyright, typescript-language-server, sentry-cli, semgrep)..."
command -v pyright >/dev/null || npm install -g pyright
# typescript@7 — нативный Go-порт без tsserver.js: typescript-language-server его не видит.
# Поэтому ставим tsls, а TypeScript 5 — вложенной зависимостью внутрь него.
if ! command -v typescript-language-server >/dev/null; then
  npm install -g typescript-language-server
  TSLS_DIR="$(npm root -g)/typescript-language-server"
  [ -d "$TSLS_DIR" ] && (cd "$TSLS_DIR" && npm install --silent typescript@5 2>/dev/null) || true
fi
command -v sentry-cli >/dev/null || npm install -g @sentry/cli
if ! command -v semgrep >/dev/null; then
  if command -v brew >/dev/null; then
    brew install semgrep
  else
    python3 -m pip install --quiet semgrep 2>/dev/null || echo "   ⚠️  semgrep не установлен — плагин semgrep будет молчать. https://semgrep.dev/docs/getting-started/"
  fi
fi

# --- CLI-утилиты ---
echo "==> Проверяю CLI-утилиты..."
if ! command -v rtk >/dev/null; then
  if command -v brew >/dev/null; then
    echo "   Устанавливаю rtk (Rust Token Killer)..."
    brew install rtk
  else
    echo "   ⚠️  rtk не установлен и brew нет. См. https://www.rtk-ai.app/"
  fi
fi
if ! command -v ezycopy >/dev/null; then
  echo "   ⚠️  ezycopy не установлен — нужен для Web Fetching Rules."
  echo "      Установка: https://github.com/gupsammy/EzyCopy (go install github.com/gupsammy/EzyCopy@latest)"
fi
if ! command -v yt-dlp >/dev/null; then
  echo "   ⚠️  yt-dlp не установлен — нужен для скилла youtube-search (brew install yt-dlp)."
fi

echo ""
echo "✅ Готово. Дальше:"
echo "   1. Запусти claude — он предложит установить плагины из settings.json"
echo "      (superpowers, skill-creator, frontend-design, pyright-lsp, typescript-lsp,"
echo "       semgrep, sentry, sentry-cli, hookify — официальный маркетплейс;"
echo "       context-mode, claude-mem, impeccable — из своих GitHub-маркетплейсов)."
echo "   2. Проверь хуки: /hooks, плагины: /plugin, MCP: claude mcp list."
echo "   3. Обновление GSD: /gsd:update. Справка: /gsd:help."
echo ""
echo "ℹ️  Компакт настроен профилем autoCompactWindow=253000 (порог срабатывания — 220k)."
echo "   Ниже 200000 прекомпьют отключается движком; см. раздел «Компакт» в README."
