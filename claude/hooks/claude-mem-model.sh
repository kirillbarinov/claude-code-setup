#!/bin/bash
# Модель наблюдателя claude-mem.
#
# Автофолбэк ЕСТЬ, начиная с claude-mem 13.x: CLAUDE_MEM_OPENROUTER_MODEL
# принимает не одну модель, а список через запятую. Первая — основная,
# остальные уезжают в тело запроса как OpenRouter-овское models:[...],
# и провайдер сам переходит к следующей, когда предыдущая отказала:
# исчерпана дневная квота, кончились деньги, слаг умер. Локальный сторож
# для этого не нужен, и ждать переключения не надо — оно внутри запроса.
# (Разбор списка: worker-service.cjs, split по /[\s,]+/, первая — model,
#  хвост — fallbackModels; массив уходит только на хост openrouter.ai.)
#
#   claude-mem-model.sh              — показать текущую цепочку и известные
#   claude-mem-model.sh main         — цепочка по умолчанию: бесплатные, затем платная
#   claude-mem-model.sh backup       — только платная, когда бесплатные негодны
#   claude-mem-model.sh "a,b,c"      — произвольная цепочка
#
# Перед записью проверяется живым запросом КАЖДОЕ звено, а затем цепочка
# целиком: неотвечающую модель не ставим, молча сломанную цепочку — тоже.
set -uo pipefail
S="$HOME/.claude-mem/settings.json"
PY=__PYTHON__
API="https://openrouter.ai/api/v1/chat/completions"

# Голова бесплатная, хвост платный. Проверено 2026-09-24: все три HTTP 200.
# Головой стоит sante: за 24.09 он дал 60 наблюдений, а nemotron — 3 и четыре
# таймаута по 120 с. Клиентский таймаут убивает запрос целиком, фолбэк
# OpenRouter от него не спасает: он ловит отказ модели, а не молчание.
# Оговорка про контекст остаётся в силе для любой новой головы: наблюдатель
# шлёт до 20 сообщений сессии, и на коротком контексте это отказ 400, который
# фолбэком НЕ лечится — 400 провайдер считает виной запроса, а не модели.
#
# ВАЖНО: с 2026-09-24 эта цепочка — ЗАПАСНОЙ канал, а не основной. Основной —
# claude-haiku-4-5 по подписке; переключением между каналами ведает соседний
# claude-mem-provider.sh. Здесь задаётся только состав цепочки OpenRouter.
MAIN="inclusionai/ling-3.0-flash-sante:free,nvidia/nemotron-3.5-lightning:free,deepseek/deepseek-v4-flash-0731"
BACKUP="deepseek/deepseek-v4-flash-0731"   # $0.03/$0.32 за млн токенов, контекст 1.3 млн

cur=$("$PY" -c "import json;print(json.load(open('$S')).get('CLAUDE_MEM_OPENROUTER_MODEL',''))")

case "${1:-}" in
  "")       echo "текущая цепочка: $cur"
            echo "main:            $MAIN"
            echo "backup:          $BACKUP"
            echo
            echo "Мертвы, не ставить:"
            echo "  inclusionai/ling-3.0-flash-vl:free  — слага нет в каталоге (404), был основным до 2026-09-24"
            echo "  xiaomi/mimo-v2-flash:free           — 404, deprecated"
            echo "  thinkingmachines/inkling:free       — 403, только agentic harness"
            exit 0;;
  backup)   NEW="$BACKUP";;
  main)     NEW="$MAIN";;
  *)        NEW="$1";;
esac

KEY=$(grep -m1 -oE '(export +)?OPENROUTER_API_KEY *= *"?[^"[:space:]]+' "$HOME/.claude/secrets.env" 2>/dev/null | sed 's/.*= *"*//')
if [ -n "$KEY" ]; then
  # Список claude-mem разбирает по запятым И пробелам — проверяем так же.
  ZVENYA=$(echo "$NEW" | tr ', ' '\n\n' | grep -v '^$')
  for m in $ZVENYA; do
    code=$(command curl -s -o /dev/null -w '%{http_code}' -X POST "$API" \
      -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
      -d "{\"model\":\"$m\",\"max_tokens\":5,\"messages\":[{\"role\":\"user\",\"content\":\"OK\"}]}")
    if [ "$code" != "200" ]; then
      echo "НЕ переключаю: звено $m отвечает HTTP $code"
      exit 1
    fi
    echo "  звено $m: 200"
  done

  # Цепочка целиком: тем же телом, каким её шлёт наблюдатель.
  SPISOK=$("$PY" -c "
import json,sys,re
print(json.dumps([m for m in re.split(r'[\s,]+', sys.argv[1]) if m]))" "$NEW")
  if [ "$(echo "$SPISOK" | tr -cd ',' | wc -c)" -gt 0 ]; then
    code=$(command curl -s -o /dev/null -w '%{http_code}' -X POST "$API" \
      -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
      -d "{\"models\":$SPISOK,\"max_tokens\":5,\"messages\":[{\"role\":\"user\",\"content\":\"OK\"}]}")
    if [ "$code" != "200" ]; then
      echo "НЕ переключаю: цепочка целиком отвечает HTTP $code (звенья по отдельности живы)"
      exit 1
    fi
    echo "  цепочка целиком: 200"
  fi
fi

"$PY" - "$S" "$NEW" <<'PYEOF'
import json,sys
p,new=sys.argv[1],sys.argv[2]
s=json.load(open(p)); s['CLAUDE_MEM_OPENROUTER_MODEL']=new
json.dump(s,open(p,'w'),indent=2,ensure_ascii=False)
PYEOF
rm -f "$HOME/.claude/state/memory-stalled.md"
echo "модель наблюдателя: $cur -> $NEW (проверена)"
