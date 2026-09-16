#!/usr/bin/env bash
# Сжать растровые ассеты для веба: PNG/JPEG → WebP (+AVIF, если стоит avifenc).
# Оригинал НЕ удаляется — он остаётся fallback'ом в <picture>.
#   optimize-assets.sh <файл-или-каталог> [качество, по умолчанию 82]
set -euo pipefail
TARGET="${1:?укажи файл или каталог}"; Q="${2:-82}"
CWEBP="$(command -v cwebp || echo /opt/homebrew/bin/cwebp)"
[ -x "$CWEBP" ] || { echo "OPTIMIZE_FAIL: нет cwebp. Поставь: brew install webp" >&2; exit 1; }
AVIF="$(command -v avifenc || true)"

human(){ awk -v b="$1" 'BEGIN{if(b>1048576)printf "%.1fМБ",b/1048576;else printf "%.0fКБ",b/1024}'; }

process(){
  local f="$1" base ext before after_w after_a
  ext="${f##*.}"; base="${f%.*}"
  before=$(/usr/bin/stat -f%z "$f")
  "$CWEBP" -q "$Q" -quiet "$f" -o "$base.webp"
  after_w=$(/usr/bin/stat -f%z "$base.webp")
  local line="  $(basename "$f"): $(human "$before") → webp $(human "$after_w")"
  if [ -n "$AVIF" ]; then
    "$AVIF" -q "$Q" "$f" "$base.avif" >/dev/null 2>&1 && \
      after_a=$(/usr/bin/stat -f%z "$base.avif") && line="$line, avif $(human "$after_a")"
  fi
  echo "$line"
}

echo "Оптимизация (q=$Q)${AVIF:+, AVIF доступен}${AVIF:-, AVIF пропущен — нет avifenc (brew install libavif)}:"
if [ -d "$TARGET" ]; then
  found=0
  while IFS= read -r f; do process "$f"; found=1; done < <(/usr/bin/find "$TARGET" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) ! -iname '*shot*' ! -path '*/node_modules/*')
  [ "$found" = 0 ] && echo "  нечего сжимать"
else
  process "$TARGET"
fi
cat <<'TIP'

Подключение в разметке (порядок важен — браузер берёт первый поддерживаемый):
  <picture>
    <source srcset="hero.avif" type="image/avif">
    <source srcset="hero.webp" type="image/webp">
    <img src="hero.png" alt="..." width="1440" height="900" loading="lazy" decoding="async">
  </picture>
В CSS: background-image: image-set(url("hero.webp") type("image/webp"), url("hero.png") type("image/png"));
TIP
