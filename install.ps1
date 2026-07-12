# Установка сетапа Claude Code на Windows (PowerShell).
# Рекомендуемый путь — WSL + install.sh (см. README). Этот скрипт — для нативной установки.
# Требования: Claude Code, Node.js 18+, Git for Windows (Git Bash нужен для bash-хуков).

$ErrorActionPreference = "Stop"

$RepoDir   = $PSScriptRoot
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"
$TS        = Get-Date -Format "yyyyMMdd-HHmmss"

Write-Host "==> Claude Code setup installer (Windows)"

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host "❌ claude не найден. Установи Claude Code: https://claude.com/claude-code" -ForegroundColor Red
  exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "❌ node не найден. Установи Node.js: winget install OpenJS.NodeJS.LTS" -ForegroundColor Red
  exit 1
}
if (-not (Get-Command bash -ErrorAction SilentlyContinue)) {
  Write-Host "⚠️  bash не найден — хуки (.sh) не смогут работать. Установи Git for Windows: winget install Git.Git" -ForegroundColor Yellow
}

foreach ($d in @("hooks", "skills", "agents", "commands")) {
  New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeDir $d) | Out-Null
}

# --- Бэкап существующих конфигов ---
foreach ($f in @("settings.json", "CLAUDE.md", "RTK.md", "statusline-command.sh")) {
  $src = Join-Path $ClaudeDir $f
  if (Test-Path $src) {
    Copy-Item $src "$src.bak-$TS"
    Write-Host "   бэкап: $src.bak-$TS"
  }
}

# --- GSD (get-shit-done): 60+ скиллов, агенты, хуки ---
if (-not (Test-Path (Join-Path $ClaudeDir "get-shit-done"))) {
  Write-Host "==> Устанавливаю GSD (get-shit-done-cc)..."
  npx -y get-shit-done-cc@latest install
} else {
  Write-Host "   GSD уже установлен, пропускаю (обновление: /gsd:update внутри Claude Code)"
}

# --- Файлы из репозитория ---
Write-Host "==> Копирую конфиги, хуки, скиллы, агентов..."
Copy-Item (Join-Path $RepoDir "claude\CLAUDE.md")              $ClaudeDir -Force
Copy-Item (Join-Path $RepoDir "claude\RTK.md")                 $ClaudeDir -Force
Copy-Item (Join-Path $RepoDir "claude\statusline-command.sh")  $ClaudeDir -Force
Copy-Item (Join-Path $RepoDir "claude\hooks\*")   (Join-Path $ClaudeDir "hooks")   -Recurse -Force
Copy-Item (Join-Path $RepoDir "claude\skills\web-test")       (Join-Path $ClaudeDir "skills") -Recurse -Force
Copy-Item (Join-Path $RepoDir "claude\skills\youtube-search") (Join-Path $ClaudeDir "skills") -Recurse -Force

# --- Документ-скиллы Anthropic: xlsx, docx, pptx, pdf (github.com/anthropics/skills) ---
if (-not (Test-Path (Join-Path $ClaudeDir "skills\xlsx"))) {
  Write-Host "==> Ставлю документ-скиллы Anthropic (xlsx, docx, pptx, pdf)..."
  $tmpSkills = Join-Path $env:TEMP "anthropic-skills-$TS"
  git clone --depth 1 https://github.com/anthropics/skills $tmpSkills 2>$null
  if (Test-Path (Join-Path $tmpSkills "skills\xlsx")) {
    foreach ($s in @("xlsx", "docx", "pptx", "pdf")) {
      Copy-Item (Join-Path $tmpSkills "skills\$s") (Join-Path $ClaudeDir "skills") -Recurse -Force
    }
    Write-Host "   xlsx, docx, pptx, pdf установлены."
  } else {
    Write-Host "   ⚠️  Не удалось клонировать anthropics/skills — поставь позже вручную." -ForegroundColor Yellow
  }
  Remove-Item $tmpSkills -Recurse -Force -ErrorAction SilentlyContinue
}

# Python-зависимости документ-скиллов (нужен Python 3; LibreOffice для конвертаций — опционально)
Write-Host "==> Python-зависимости документ-скиллов..."
if (Get-Command python -ErrorAction SilentlyContinue) {
  python -m pip install --quiet openpyxl pandas python-docx pypdf pdfplumber pymupdf markitdown
} else {
  Write-Host "   ⚠️  Python не найден — поставь (winget install Python.Python.3.12), затем: python -m pip install openpyxl pandas python-docx pypdf pdfplumber pymupdf markitdown" -ForegroundColor Yellow
}
Copy-Item (Join-Path $RepoDir "claude\agents\*.md")   (Join-Path $ClaudeDir "agents")   -Force
Copy-Item (Join-Path $RepoDir "claude\commands\*.md") (Join-Path $ClaudeDir "commands") -Force
# claude/scripts (team-*) — только для macOS (osascript/tmux), на Windows не копируются.

# settings.json: подставляем домашнюю директорию (forward slashes — так пути понимает и Git Bash)
$homeFwd = $env:USERPROFILE -replace '\\', '/'
(Get-Content (Join-Path $RepoDir "claude\settings.json") -Raw) -replace '__HOME__', $homeFwd |
  Set-Content (Join-Path $ClaudeDir "settings.json") -Encoding UTF8
Write-Host "   settings.json установлен (старый — в бэкапе)"

# --- MCP: chrome-devtools ---
$mcpList = claude mcp list 2>$null
if ($mcpList -notmatch "chrome-devtools") {
  Write-Host "==> Регистрирую MCP chrome-devtools..."
  claude mcp add -s user chrome-devtools -- npx -y chrome-devtools-mcp@latest
}

# --- MCP: context7 (актуальные доки библиотек, ключ не нужен) ---
if ($mcpList -notmatch "context7") {
  Write-Host "==> Регистрирую MCP context7..."
  claude mcp add -s user context7 -- npx -y "@upstash/context7-mcp@latest"
}

# --- MCP: perplexity (нужен свой API-ключ: https://www.perplexity.ai/settings/api) ---
if ($mcpList -notmatch "perplexity-mcp") {
  Write-Host ""
  Write-Host "==> Perplexity MCP — весь веб-поиск идёт через него (hook блокирует встроенный)."
  $pplxKey = Read-Host "   Введи PERPLEXITY_API_KEY (Enter — пропустить)"
  if ($pplxKey) {
    claude mcp add -s user perplexity-mcp -e "PERPLEXITY_API_KEY=$pplxKey" -- npx -y "@jschuller/perplexity-mcp"
    Write-Host "   perplexity-mcp зарегистрирован."
  } else {
    Write-Host "   ⚠️  Пропущено. Без ключа perplexity-guard будет блокировать веб-поиск —"
    Write-Host "      либо добавь MCP позже: claude mcp add -s user perplexity-mcp -e PERPLEXITY_API_KEY=<ключ> -- npx -y @jschuller/perplexity-mcp"
    Write-Host "      либо отключи guard: создай файл ~\.claude\perplexity-guard.disabled (10-мин окно) или убери его из settings.json"
  }
}

# --- Бинари для плагинов: LSP-серверы, sentry-cli, semgrep ---
Write-Host "==> Бинари для плагинов (pyright, typescript-language-server, sentry-cli, semgrep)..."
if (-not (Get-Command pyright -ErrorAction SilentlyContinue)) { npm install -g pyright }
if (-not (Get-Command typescript-language-server -ErrorAction SilentlyContinue)) { npm install -g typescript-language-server typescript }
if (-not (Get-Command sentry-cli -ErrorAction SilentlyContinue)) { npm install -g "@sentry/cli" }
if (-not (Get-Command semgrep -ErrorAction SilentlyContinue)) {
  if (Get-Command python -ErrorAction SilentlyContinue) {
    python -m pip install --quiet semgrep
  } else {
    Write-Host "   ⚠️  semgrep не установлен — плагин semgrep будет молчать. https://semgrep.dev/docs/getting-started/" -ForegroundColor Yellow
  }
}

# --- CLI-утилиты ---
Write-Host "==> Проверяю CLI-утилиты..."
if (-not (Get-Command rtk -ErrorAction SilentlyContinue)) {
  Write-Host "   ⚠️  rtk не установлен (на Windows brew нет). См. https://www.rtk-ai.app/"
  Write-Host "      Без rtk хук rtk-rewrite просто пропускает команды — всё работает, но без экономии токенов."
}
if (-not (Get-Command ezycopy -ErrorAction SilentlyContinue)) {
  Write-Host "   ⚠️  ezycopy не установлен — нужен для Web Fetching Rules."
  Write-Host "      Установка (нужен Go): go install github.com/gupsammy/EzyCopy@latest"
}
if (-not (Get-Command yt-dlp -ErrorAction SilentlyContinue)) {
  Write-Host "   ⚠️  yt-dlp не установлен — нужен для скилла youtube-search: winget install yt-dlp.yt-dlp"
}

Write-Host ""
Write-Host "✅ Готово. Дальше:" -ForegroundColor Green
Write-Host "   1. Запусти claude — он предложит установить плагины из settings.json"
Write-Host "      (superpowers, skill-creator, frontend-design, pyright-lsp, typescript-lsp,"
Write-Host "       semgrep, sentry, sentry-cli, hookify — официальный маркетплейс;"
Write-Host "       context-mode, claude-mem, impeccable — из своих GitHub-маркетплейсов)."
Write-Host "   2. Проверь хуки: /hooks, плагины: /plugin, MCP: claude mcp list."
Write-Host "   3. Обновление GSD: /gsd:update. Справка: /gsd:help."
