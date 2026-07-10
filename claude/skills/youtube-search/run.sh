#!/usr/bin/env bash
# YouTube Search Skill — uses yt-dlp to search and display video info
# Usage: run.sh <query> [--limit N] [--min-duration MINUTES]

set -euo pipefail

QUERY="${1:-}"
LIMIT=10
MIN_DURATION_SECS=600   # 10 minutes default
YT_DLP=""

if [[ -z "$QUERY" ]]; then
  echo "Usage: youtube-search <query> [--limit N] [--min-duration MINUTES]"
  exit 1
fi

shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit|-n)        LIMIT="$2"; shift 2 ;;
    --min-duration)    MIN_DURATION_SECS=$(( $2 * 60 )); shift 2 ;;
    *) shift ;;
  esac
done

# Fetch 4x more results to have buffer after filtering
FETCH=$(( LIMIT * 4 ))

# Find yt-dlp: prefer newer binary, fallback to system
for candidate in \
  "$HOME/opt/anaconda3/bin/yt-dlp-new" \
  "$HOME/.local/bin/yt-dlp" \
  "$(which yt-dlp 2>/dev/null || true)"; do
  if [[ -x "$candidate" ]]; then
    YT_DLP="$candidate"
    break
  fi
done

if [[ -z "$YT_DLP" ]]; then
  echo "Error: yt-dlp not found. Install with: pip install yt-dlp"
  exit 1
fi

# --flat-playlist fetches search results without requesting each video page
# (avoids YouTube bot detection)
RAW=$("$YT_DLP" \
  "ytsearch${FETCH}:${QUERY}" \
  --flat-playlist \
  --print "%(title)s	%(view_count)s	%(uploader)s	%(duration)s	%(duration_string)s	%(webpage_url)s" \
  --no-warnings \
  2>/dev/null) || true

if [[ -z "$RAW" ]]; then
  echo "No results found for: $QUERY"
  exit 0
fi

echo "$RAW" | awk -F'\t' -v limit="$LIMIT" -v min_dur="$MIN_DURATION_SECS" '
BEGIN {
  printf "\n\033[1m%-3s  %-54s  %9s  %-22s  %9s\033[0m\n",
    "#", "Title", "Views", "Channel", "Duration"
  printf "%s\n",
    "---  " \
    "------------------------------------------------------  " \
    "---------  " \
    "----------------------  " \
    "---------"
  i = 1
}
{
  if (i > limit) exit

  title    = substr($1, 1, 54)
  views    = $2 + 0
  author   = substr($3, 1, 22)
  dur_secs = $4 + 0
  dur_str  = $5
  url      = $6

  # Filter: skip videos shorter than min_dur seconds
  if (dur_secs > 0 && dur_secs < min_dur) next

  # Format views
  if (views >= 1000000000)
    views_fmt = sprintf("%.1fB", views/1000000000)
  else if (views >= 1000000)
    views_fmt = sprintf("%.1fM", views/1000000)
  else if (views >= 1000)
    views_fmt = sprintf("%.1fK", views/1000)
  else if (views > 0)
    views_fmt = views ""
  else
    views_fmt = "—"

  printf "%-3d  %-54s  %9s  %-22s  %9s\n",
    i, title, views_fmt, author, dur_str
  printf "     \033[2m%s\033[0m\n\n", url
  i++
}
'
