#!/bin/bash
# Conditional ultrathink: trigger extended thinking only for complex prompts.
# Conditions: prompt length > 200 chars OR contains trigger words.

INPUT=$(cat)

PROMPT=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('prompt', ''))
except Exception:
    print('')
" 2>/dev/null)

PROMPT_LEN=${#PROMPT}
PROMPT_LOWER=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')

# Russian triggers
RU_PATTERN="\/deep|архитектур|сложн|рефакторинг|оптимизац|анализ|исследован|объясни|объяснен|подробно|детально|разработай|спроектируй|реализу|алгоритм|стратег|почему|как работает|отладк|сравни|сравнен|оцени|оценк|глубок|проблем|дизайн|реализац|спорн|трудн|внедр"

# English triggers
EN_PATTERN="architecture|complex|refactor|optim|analyz|research|explain|detailed|design|implement|algorithm|strategy|why|how does|how do|debug|compare|evaluat|difficult|hard|intricate|elaborate|tricky|deep dive|breakdown|trade.?off|pros.?cons|scalab|perform|secur|vulnerab|bottleneck"

SHOULD_THINK=false

# Long prompt
if [ "$PROMPT_LEN" -gt 200 ]; then
    SHOULD_THINK=true
fi

# Russian trigger words
if echo "$PROMPT_LOWER" | grep -qE "$RU_PATTERN"; then
    SHOULD_THINK=true
fi

# English trigger words
if echo "$PROMPT_LOWER" | grep -qiE "$EN_PATTERN"; then
    SHOULD_THINK=true
fi

if [ "$SHOULD_THINK" = "true" ]; then
    echo '{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "ultrathink"}}'
fi
