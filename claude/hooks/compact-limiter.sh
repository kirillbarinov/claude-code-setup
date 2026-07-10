#!/bin/bash
# Limits auto-compact to 3 times per session
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "default"')
COMPACT_TYPE=$(echo "$INPUT" | jq -r '.type // "auto"')

# Only limit auto-compacts (triggered by autoCompactWindow)
# Manual /compact always allowed
if [ "$COMPACT_TYPE" = "manual" ]; then
    exit 0
fi

COUNTER_FILE="/tmp/claude_compact_${SESSION_ID}"

COUNT=0
if [ -f "$COUNTER_FILE" ]; then
    COUNT=$(cat "$COUNTER_FILE")
fi

if [ "$COUNT" -ge 3 ]; then
    echo '{"continue": false, "stopReason": "Auto-compact limit reached (3/3 for this session). Use /compact manually if needed."}'
    exit 0
fi

echo $((COUNT + 1)) > "$COUNTER_FILE"
exit 0
