-- team-panes.applescript
-- Layout: main agent (left, full height) + 2×2 right (4 teammates)
--
-- ┌──────────┬────────────┬────────────┐
-- │          │  backend   │  frontend  │
-- │  main    ├────────────┼────────────┤
-- │  agent   │  security  │  documenter│
-- └──────────┴────────────┴────────────┘
--
-- Requires: /tmp/team/project-dir to exist with the project path
-- Created by: team-start.sh or manually before calling this script

-- Initialize log files
do shell script "mkdir -p /tmp/team/backend /tmp/team/frontend /tmp/team/security /tmp/team/docs"
do shell script "printf '\\n\\n=== SESSION STARTED: ' > /tmp/team-lead.log; date >> /tmp/team-lead.log"

-- Read project directory (written by the main agent before calling this script)
set projectDir to (do shell script "cat /tmp/team/project-dir 2>/dev/null || pwd")

-- Role-specific system prompts (no single quotes inside!)
set backendPrompt to "You are the backend engineer on this development team. When given a task, implement it carefully. Allowed files: backend/**, server/**, api/**, db/**, migrations/**, tests/backend/**. FORBIDDEN: frontend files, UI components, styles. After completing, write a results summary to /tmp/team/backend/result.md and end with the word DONE on the last line."

set frontendPrompt to "You are the frontend engineer on this development team. When given a task, implement it carefully. Allowed files: frontend/**, client/**, components/**, pages/**, styles/**, public/**, tests/frontend/**. FORBIDDEN: backend files, server code, DB schemas. After completing, write a results summary to /tmp/team/frontend/result.md and end with the word DONE on the last line."

set securityPrompt to "You are the security auditor on this development team. When given a task, review the code for OWASP Top 10 vulnerabilities, hardcoded secrets, auth issues, unsafe dependencies, and logic errors. Report format: severity (critical/high/medium/low), file:line, description, recommendation. Write your report to /tmp/team/security/result.md and end with the word DONE on the last line."

set docsPrompt to "You are the documentation specialist on this development team. When given a task, update README.md, API docs, docstrings, CHANGELOG. FORBIDDEN: changing logic or business code, only documentation. After completing, write a summary to /tmp/team/docs/result.md and end with the word DONE on the last line."

tell application "iTerm2"
  activate

  set newWin to (create window with default profile)

  tell newWin
    tell current tab

      -- ── Step 1: s1 = left column (main agent progress monitor) ──────────────
      set s1 to current session
      tell s1
        set name to "main-agent"
      end tell

      -- ── Step 2: split right column ──────────────────────────────────────────
      set s_tr to (split vertically with same profile of s1)

      -- ── Step 3: split right column horizontally → top and bottom rows ───────
      set s_br to (split horizontally with same profile of s_tr)

      -- ── Step 4: split top row → backend | frontend ───────────────────────────
      set s_frontend to (split vertically with same profile of s_tr)

      -- ── Step 5: split bottom row → security | documenter ─────────────────────
      set s_docs to (split vertically with same profile of s_br)

      -- ── Main agent pane (left column) ─────────────────────────────────────────
      tell s1
        write text "clear && echo 'MAIN AGENT - Team Lead' && tail -f /tmp/team-lead.log"
      end tell

      -- ── Backend engineer pane ─────────────────────────────────────────────────
      tell s_tr
        set name to "backend-engineer"
        write text "cd " & quoted form of projectDir & " && claude --dangerously-skip-permissions --append-system-prompt " & quoted form of backendPrompt
      end tell

      -- ── Frontend engineer pane ────────────────────────────────────────────────
      tell s_frontend
        set name to "frontend-engineer"
        write text "cd " & quoted form of projectDir & " && claude --dangerously-skip-permissions --append-system-prompt " & quoted form of frontendPrompt
      end tell

      -- ── Security auditor pane ─────────────────────────────────────────────────
      tell s_br
        set name to "security-auditor"
        write text "cd " & quoted form of projectDir & " && claude --dangerously-skip-permissions --append-system-prompt " & quoted form of securityPrompt
      end tell

      -- ── Documenter pane ───────────────────────────────────────────────────────
      tell s_docs
        set name to "documenter"
        write text "cd " & quoted form of projectDir & " && claude --dangerously-skip-permissions --append-system-prompt " & quoted form of docsPrompt
      end tell

      -- ── Accept workspace trust dialogs ────────────────────────────────────────
      -- Claude shows a trust dialog on new sessions; delay then send Enter to accept
      delay 7

      tell s_tr
        write text ""
      end tell
      tell s_frontend
        write text ""
      end tell
      tell s_br
        write text ""
      end tell
      tell s_docs
        write text ""
      end tell

    end tell
  end tell
end tell
