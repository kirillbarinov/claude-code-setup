#!/usr/bin/env bash
# project-map-start.sh — SessionStart hook: пересчёт карты проекта.
#
# Сам ничего не печатает и ничего не ждёт: генератор уходит в фон, потому что
# его результат нужен не сейчас, а когда Claude дойдёт до файлов модуля —
# подкаталожный CLAUDE.md подгружается по требованию, а не на старте.
#
# Генератор трогает только зону между маркерами КАРТА:НАЧАЛО/КОНЕЦ и только
# там, где код новее карты. Второй прогон подряд не пишет ничего.

set -uo pipefail

GEN="$HOME/.claude/hooks/project-map-build.mjs"
[ -f "$GEN" ] || exit 0

# Домашняя папка и корень — не проекты.
[ "$PWD" = "$HOME" ] || [ "$PWD" = "/" ] && exit 0

is_project=0
[ -d .git ] && is_project=1
for marker in package.json pyproject.toml Cargo.toml go.mod pom.xml build.gradle \
              build.gradle.kts composer.json Gemfile CMakeLists.txt settings.gradle; do
  [ -f "$marker" ] && is_project=1
done
# Одного CLAUDE.md мало: он есть и в папках, где кода нет.
[ "$is_project" = "1" ] || exit 0

node "$GEN" >/dev/null 2>&1 &

exit 0
