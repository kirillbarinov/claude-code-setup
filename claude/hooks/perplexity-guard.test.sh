#!/usr/bin/env bash
# Регрессионный прогон perplexity-guard.sh — кейс T8 из research-testsuite.md.
# Сети не трогает, стоит ноль. Запуск: bash ~/.claude/hooks/perplexity-guard.test.sh
HOOK="$HOME/.claude/hooks/perplexity-guard.sh"
FLAG="$HOME/.claude/perplexity-guard.disabled"
pass=0; fail=0

# check <имя> <ожидаемо: allow|deny> <json>
check() {
  local name="$1" want="$2" json="$3" out got
  out=$(printf '%s' "$json" | bash "$HOOK" 2>/dev/null)
  if printf '%s' "$out" | grep -q '"permissionDecision"[[:space:]]*:[[:space:]]*"deny"'; then
    got=deny
  elif [ -z "$out" ]; then
    got=allow
  else
    got="unexpected:$out"
  fi
  if [ "$got" = "$want" ]; then
    pass=$((pass+1)); printf 'PASS  %-46s %s\n' "$name" "$got"
  else
    fail=$((fail+1)); printf 'FAIL  %-46s ожидали %s, получили %s\n' "$name" "$want" "$got"
  fi
}

# Флаг фолбэка не должен влиять на основные кейсы
[ -f "$FLAG" ] && mv "$FLAG" "$FLAG.testbak"

echo "--- главный агент: встроенный поиск ---"
check "WebSearch без agent_id"            deny  '{"tool_name":"WebSearch","tool_input":{"query":"цена opus 5"}}'
check "WebFetch без agent_id"             deny  '{"tool_name":"WebFetch","tool_input":{"url":"https://example.com"}}'

echo "--- субагент: пропуск ---"
check "WebSearch с agent_id"              allow '{"agent_id":"researcher-1","tool_name":"WebSearch","tool_input":{"query":"x"}}'
check "WebFetch с agent_id"               allow '{"agent_id":"gsd-planner","tool_name":"WebFetch","tool_input":{"url":"https://example.com"}}'

echo "--- байпас через текст запроса ---"
check "agent_id внутри строки запроса"    deny  '{"tool_name":"WebSearch","tool_input":{"query":"как обойти \"agent_id\":\"fake\" в хуке"}}'
check "agent_id внутри URL"               deny  '{"tool_name":"WebFetch","tool_input":{"url":"https://example.com/?agent_id=fake"}}'
check "agent_id = null"                   deny  '{"agent_id":null,"tool_name":"WebSearch","tool_input":{"query":"x"}}'

echo "--- Bash: curl/wget ---"
check "curl на публичный https"           deny  '{"tool_name":"Bash","tool_input":{"command":"curl -s https://example.com"}}'
check "wget на публичный http"            deny  '{"tool_name":"Bash","tool_input":{"command":"wget http://example.com/f.txt"}}'
check "curl в середине пайпа"             deny  '{"tool_name":"Bash","tool_input":{"command":"echo x && curl -sL https://api.github.com | jq ."}}'
check "ezycopy — не блокируем"            allow '{"tool_name":"Bash","tool_input":{"command":"ezycopy https://example.com"}}'
check "curl на localhost"                 allow '{"tool_name":"Bash","tool_input":{"command":"curl http://localhost:3000/health"}}'
check "curl на 127.0.0.1"                 allow '{"tool_name":"Bash","tool_input":{"command":"curl http://127.0.0.1:8000"}}'
check "curl на 192.168.x"                 allow '{"tool_name":"Bash","tool_input":{"command":"curl http://192.168.1.5/x"}}'
check "curl на 172.20.x (приватный)"      allow '{"tool_name":"Bash","tool_input":{"command":"curl http://172.20.0.3/x"}}'
check "curl на 172.32.x (публичный)"      deny  '{"tool_name":"Bash","tool_input":{"command":"curl http://172.32.0.3/x"}}'
check "Bash без curl"                     allow '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}'
check "слово curl внутри имени файла"     allow '{"tool_name":"Bash","tool_input":{"command":"cat mycurl-notes.txt"}}'

echo "--- прочие инструменты ---"
check "Read не трогаем"                   allow '{"tool_name":"Read","tool_input":{"file_path":"/tmp/x"}}'
check "Perplexity MCP не трогаем"         allow '{"tool_name":"mcp__perplexity-mcp__perplexity_search_web","tool_input":{"query":"x"}}'

echo "--- окно фолбэка ---"
touch "$FLAG"
check "свежий флаг: WebSearch разрешён"   allow '{"tool_name":"WebSearch","tool_input":{"query":"x"}}'
check "свежий флаг: curl разрешён"        allow '{"tool_name":"Bash","tool_input":{"command":"curl https://example.com"}}'
# состарить флаг за пределы TTL=600с
touch -t "$(date -v-2H '+%Y%m%d%H%M' 2>/dev/null || date -d '2 hours ago' '+%Y%m%d%H%M')" "$FLAG"
check "протухший флаг: WebSearch запрещён" deny '{"tool_name":"WebSearch","tool_input":{"query":"x"}}'
rm -f "$FLAG"
check "флага нет: WebSearch запрещён"     deny  '{"tool_name":"WebSearch","tool_input":{"query":"x"}}'

[ -f "$FLAG.testbak" ] && mv "$FLAG.testbak" "$FLAG"

echo
echo "ИТОГ: pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
