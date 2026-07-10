#!/bin/sh
export PATH="/opt/homebrew/bin:$PATH"
input=$(cat)

# Model name
model=$(echo "$input" | jq -r '.model.display_name // empty')

# Context window size (in K)
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
if [ -n "$ctx_size" ]; then
  ctx_k=$(( ctx_size / 1000 ))
  ctx_label="${ctx_k}K"
else
  ctx_label=""
fi

# Context usage percentage
ctx_used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
if [ -n "$ctx_used" ]; then
  ctx_used_fmt=$(printf '%.0f' "$ctx_used")
  ctx_part="ctx: ${ctx_used_fmt}%"
else
  # Fallback: calculate manually from current_usage when used_percentage is null
  input_tokens=$(echo "$input" | jq -r '.context_window.current_usage.input_tokens // empty')
  if [ -n "$input_tokens" ] && [ -n "$ctx_size" ] && [ "$ctx_size" -gt 0 ] 2>/dev/null; then
    ctx_used_calc=$(echo "$input_tokens $ctx_size" | awk '{printf "%.0f", $1 / $2 * 100}')
    ctx_part="ctx: ${ctx_used_calc}%"
  else
    ctx_part="ctx: init"
  fi
fi

# Model + context line
if [ -n "$model" ]; then
  if [ -n "$ctx_label" ]; then
    model_part="${model} (${ctx_label}) | ${ctx_part}"
  else
    model_part="${model} | ${ctx_part}"
  fi
else
  model_part="${ctx_part}"
fi

# Rate limit: 5-hour session
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
five_resets=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')

if [ -n "$five_pct" ]; then
  used=$(printf '%.0f' "$five_pct")
  if [ -n "$five_resets" ]; then
    reset_time=$(TZ="Europe/Moscow" date -r "$five_resets" "+%-I%p" 2>/dev/null | tr '[:upper:]' '[:lower:]')
    session_part="session: ${used}% used | resets ${reset_time} MSK"
  else
    session_part="session: ${used}% used"
  fi
else
  session_part="session: 0% used"
fi

printf "%s | %s" "$model_part" "$session_part"
