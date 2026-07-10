#!/bin/bash
# Prepares /tmp/team/ and launches the iTerm2 team panes.
# Call this from the project root directory (or pass dir as arg).
# Usage: team-start.sh [project-dir]

PROJECT_DIR="${1:-$PWD}"

# Create task/result directories for each role
mkdir -p /tmp/team/backend /tmp/team/frontend /tmp/team/security /tmp/team/docs

# Clear previous task/result files
rm -f /tmp/team/backend/{task,result}.md \
      /tmp/team/frontend/{task,result}.md \
      /tmp/team/security/{task,result}.md \
      /tmp/team/docs/{task,result}.md

# Write project directory so the applescript can read it
echo "$PROJECT_DIR" > /tmp/team/project-dir

# Clear team logs
for log in lead backend frontend security docs; do
  printf '\n\n=== SESSION STARTED: ' > "/tmp/team-$log.log"
  date >> "/tmp/team-$log.log"
done

echo "[team-start] Project: $PROJECT_DIR"
echo "[team-start] Launching iTerm2 panes..."

osascript ~/.claude/scripts/team-panes.applescript

echo "[team-start] Done."
