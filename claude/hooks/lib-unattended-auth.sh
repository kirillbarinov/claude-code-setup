# Подключается (source) фоновыми задачами, которые зовут `claude -p`.
#
# Вход CLI (`claude auth login`) истекает молча: 01.11 и 08.11.2026 плановый аудит,
# писатель вики и наблюдатель claude-mem упали с «Not logged in» / «organization
# has disabled Claude subscription access», а launchd видел код 0.
# Для фона нужен долгий токен. Один раз, руками:
#   claude setup-token
#   security add-generic-password -U -s claude-unattended-token -a "$USER" -w '<токен>'
# Нет токена в связке ключей — работаем на обычном входе CLI, как раньше.
#
# Ключи API (PERPLEXITY_API_KEY и др.) живут в ~/.claude/secrets.env. Интерактивные сессии
# получают их через ~/.zshrc, а launchd .zshrc не читает: 09.11.2026 perplexity-MCP
# в плановом аудите упал с «PERPLEXITY_API_KEY environment variable is required».
# set -a: строки без export тоже уходят в окружение claude.
if [ -f "$HOME/.claude/secrets.env" ]; then set -a; . "$HOME/.claude/secrets.env"; set +a; fi
AUTH_SOURCE="вход CLI"
if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  _unattended_token=$(security find-generic-password -s claude-unattended-token -a "$USER" -w 2>/dev/null)
  # setup-token переносит длинный токен по ширине терминала; при копировании перенос
  # становится пробелом (09.11.2026: 401 / «Not logged in»). В токене пробелов не бывает.
  _unattended_token=$(printf %s "$_unattended_token" | tr -d '[:space:]')
  if [ -n "$_unattended_token" ]; then
    export CLAUDE_CODE_OAUTH_TOKEN="$_unattended_token"
    AUTH_SOURCE="токен из связки ключей"
  fi
  unset _unattended_token
fi
