---
description: Start/stop a Claude Code Agent Team — subagent or native mode
argument-hint: start [task] | status | pause | stop | cleanup | mode
---

# Agent Team Orchestrator

User argument: $ARGUMENTS

You are the team lead. This skill supports **two modes**:

| Mode | When to use |
|---|---|
| `--sub` | Always works. Uses the Agent tool (subagent_type). Teammates report back to you. |
| `--native` | Only if `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in the environment. True native agent team with shared task list, mailbox, split panes. |

Default (no flag): check env first — if EXPERIMENTAL is enabled use `--native`, otherwise use `--sub`.

---

## Argument Parsing

- **Empty** → print help (list of subcommands + current mode).
- **`mode`** → show which mode is active and why.
- **`start`** without a description → ask for the task. Wait for reply.
- **`start <task>`** → proceed to "Launch".
- **`status`** → show: team name, phase, task list, who is doing what.
- **`pause`** → send all active teammates: "Finish your current tool call, don't pick up new tasks, wait for instructions."
- **`stop` / `cleanup`** → proceed to "Shutdown".

---

## Launch (`start <task>`)

### Phase 0 — Mode Selection & Planning (REQUIRED before spawning)

1. **Determine mode**: check if `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` via `Bash("echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS")`. If `1` and `--sub` is not explicitly set → native. Otherwise → subagent.
2. Report to user: "Mode: [native / subagent]. Reason: [...]"
3. Explore the repository yourself (structure, stack, CLAUDE.md, conventions).
4. Draft a plan:
   - Break into phases (Implementation → Review → Docs).
   - Task list: owner, allowed paths/globs, dependencies, deliverable.
   - Boundary files (shared types, schemas) — single owner only.
5. Present the plan and **wait for explicit approval** (`plan ok`, `go`, `approved`). Spawn no one until approved.

---

### Phase 1 — Implementation

#### Available agents (ONLY these, no others)

The project defines exactly 4 agents in `.claude/agents/`. Use only them:

| subagent_type | Responsibility |
|---|---|
| `backend-engineer` | `backend/`, `*.py`, DB, API |
| `frontend-engineer` | `frontend/`, `*.tsx`, `*.ts`, `*.css` |
| `security-auditor` | Code review, report to `reports/security/` — Phase 2 only |
| `documenter` | README, docs, CHANGELOG, docstrings — Phase 3 only |

> **FORBIDDEN** to spawn agents with any other names (researcher, analyst, db-inspector, etc.). If a task doesn't fit these 4 roles — handle it yourself as lead or delegate to the nearest fitting role.

#### Mode `--sub` (subagent via Agent tool)

Spawn via the `Agent` tool with `subagent_type`:
- `backend-engineer` → writes backend, reports back with result
- `frontend-engineer` → writes frontend, reports back with result

Give each agent a fully self-contained prompt — they don't see the conversation history.
Always include in the prompt:
- Exactly what needs to be done (specific files, tasks)
- Allowed paths (so they don't touch other zones)
- Stack and conventions (if not obvious from CLAUDE.md)
- Deliverable: what counts as done

When an agent returns its result — synthesize, decide if fixes are needed.
Agents run in parallel only if their file zones don't overlap — launch them in the same message.

#### Mode `--native` (native agent team)

Use the built-in Claude Code native mechanisms:
- `TeamCreate` — create the team
- `TaskCreate` — push tasks to the shared task list with dependencies
- Spawn teammates by subagent types from `.claude/agents/`
- Use `SendMessage` to communicate with teammates
- Use `TaskList` / `TaskGet` / `TaskUpdate` to monitor progress

**Do not** manually edit `~/.claude/teams/<team>/config.json` — it will be overwritten.

Monitor the mailbox, resolve blockers, pass clarifications via message to a specific teammate.

**Split panes (--native only)**: if the user wants to see each teammate in a separate terminal pane — remind them to enable tmux or configure `~/.claude.json`: `{"teammateMode": "tmux"}`.

Wait for all teammates to mark their tasks as completed. If task status lags (known issue) — nudge via message or ask the user to check.

**In both modes**: the lead writes no code. Only planning, coordination, synthesis.

---

### Phase 2 — Review & QA

Only when Phase 1 is fully complete. The security-auditor is not just a code reviewer — it's an autonomous QA engineer: it tests the live application via Playwright CLI (default) or Chrome DevTools MCP (if registered in the project's `.mcp.json`). It has virtual hands (clicks, input) and virtual eyes (console, network, pageerror).

**Before spawning the auditor (once per project)** check browser tooling readiness:
1. `Bash("test -d node_modules/playwright || test -d node_modules/@playwright/test && echo installed || echo missing")` — if `missing`, ask the user: install `npm i -D @playwright/test` or rely on `npx playwright` (downloads browser on first run).
2. `Bash("npx playwright install --dry-run chromium 2>&1 | head -5")` — confirm Chromium is available. If not — `npx playwright install chromium` (one-time, may take 1–2 minutes).
3. If the project has `.mcp.json` with `chrome-devtools` — verify Claude Code was restarted after it was created (otherwise the MCP server wasn't picked up). If unsure — warn the user in one line and continue with Playwright.

**`--sub`** — spawn `security-auditor` via Agent tool. Include in the prompt:
- Path to the diff / list of changed files.
- Explicit instruction: "start the application, run Playwright scenarios, verify golden path + regressions in adjacent features, save the report to `reports/security/<slug>.md` and artifacts to `reports/qa/<slug>/`".
- Requirement to end the final message with a `QA_VERDICT: PASS|FAIL` block (format described in the agent).

When the auditor returns — parse the last message:

1. **`QA_VERDICT: PASS`** → proceed to Phase 3.
2. **`QA_VERDICT: FAIL`** → open `reports/security/<slug>.md`, find the `## Fix Requests` section. For each Fix Request:
   - Spawn the engineer named in `Target agent` (`frontend-engineer` or `backend-engineer`) via Agent tool.
   - Prompt strictly from the Fix Request: file:line, symptom, root-cause hypothesis, reproduction, evidence path. Restrict changes to the affected files only.
   - Wait for each engineer to finish.
3. After all fixes — **re-spawn security-auditor** with the instruction: "retest the scenarios marked as FAIL in `reports/security/<slug>.md`, update the report, return a new QA_VERDICT".
4. Repeat the cycle up to **3 times**. If still FAIL after the 3rd iteration — stop, report to the user: show the attempt history, which scenarios failed and why, and WAIT for instructions. Do not touch the code yourself.

**`--native`** — create a task for `security-auditor` in the shared task list with the same content. In native mode the auditor delegates fixes to `frontend-engineer` / `backend-engineer` via `SendMessage` and re-runs its own Playwright scenarios — you just monitor the mailbox and task status. Same 3-iteration limit applies; if the auditor escalates — relay to the user.

In both modes: backend/frontend do not touch code on their own initiative in Phase 2. Any fix only happens via a Fix Request from the auditor.

---

### Phase 3 — Documentation

Only when the security-auditor has finished and critical findings are resolved:

**`--sub`**: spawn `documenter` via Agent tool.

**`--native`**: spawn `documenter` as a teammate.

Task: update README, docs, CHANGELOG, docstrings. Documentation only, no executable code.

---

### Wrap-up

Synthesize the outcome: what was done, key decisions, link to security report, link to CHANGELOG.
Ask the user: "Can the team be cleaned up? (`/team stop`)"

> **STOP. DO NOT CLEANUP ON YOUR OWN.** Do not call shutdown for teammates, do not clean up the team, do not kill sessions. Wait for an explicit `/team stop` command from the user. This rule must not be broken even if "it looks like the work is done".

---

## Shutdown (`stop` / `cleanup`)

**`--sub`**: agents have already finished (they return a result, they don't hang). No cleanup needed — just confirm completion.

**`--native`**:
1. Check for active teammates. If any → politely ask each to shut down (native shutdown request). Wait for confirmation.
2. Only after that → native team cleanup (removes shared resources).
3. Confirm to the user: "Team cleaned up, back to single-agent mode."

---

## Hard Rules

1. **File zones are inviolable.** Boundary files — separate task, single owner.
2. **Phases are strictly sequential.** Implementation → Review → Docs. Parallelism only within Implementation and only between non-overlapping zones.
3. **Lead writes no code and runs no shell commands.** Planning, coordination, synthesis, communication with the user. This includes trivial operations like deleting files, renaming, or moving — delegate to the appropriate agent, always.
4. **Prompts for subagent-mode agents are self-contained** — they don't see the conversation history; include all context in the prompt.
5. **React to user messages mid-phase** — relay via mailbox (native) or keep in mind for the next agent (sub). Do not touch the code yourself.
6. **Mode is chosen once** at `start` and does not change during the team's work.
7. **Auditor is mandatory.** Phase 2 (security-auditor) is NEVER skipped — even if the changes seem trivial. Exception: only if the user explicitly wrote `--no-audit` in the arguments. Without that flag — spawning the auditor is required before Phase 3. Do NOT rationalize skipping it because the task "seems safe" — that judgment belongs to the auditor, not the lead.

---

Now process $ARGUMENTS.
