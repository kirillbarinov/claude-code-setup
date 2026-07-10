#!/bin/bash
# Send a message to a teammate pane in iTerm2 by session name.
# Usage: team-send.sh <role> "<message>"
# Example: team-send.sh backend-engineer "Read /tmp/team/backend/task.md and start your task."

ROLE="${1:?Usage: team-send.sh <role> <message>}"
MESSAGE="${2:?Usage: team-send.sh <role> <message>}"

result=$(osascript - "$ROLE" "$MESSAGE" << 'APPLESCRIPT'
on run argv
  set roleName to item 1 of argv
  set msg to item 2 of argv

  tell application "iTerm2"
    set targetSession to missing value
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if name of s contains roleName then
            set targetSession to s
            exit repeat
          end if
        end repeat
        if targetSession is not missing value then exit repeat
      end repeat
      if targetSession is not missing value then exit repeat
    end repeat

    if targetSession is not missing value then
      tell targetSession
        write text msg
      end tell
      return "sent"
    else
      return "not-found"
    end if
  end tell
end run
APPLESCRIPT
)

if [ "$result" = "sent" ]; then
  echo "[team-send] ✓ Sent to '$ROLE'"
else
  echo "[team-send] ✗ Session '$ROLE' not found in iTerm2" >&2
  exit 1
fi
