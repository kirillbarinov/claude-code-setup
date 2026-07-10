---
name: web-test
description: "Smoke-test the current web app in a real browser. Use when the user wants to open/run the app and check it works in a browser, verify a UI change visually, or asks to /web-test. Opens the dev server, drives the golden path, watches console/network, returns PASS/FAIL — all in an isolated subagent so browser noise never enters the main session."
---

# /web-test

Run a lightweight in-browser smoke test of the current development work, keeping
the main session's context clean.

## How to run it

**Delegate everything to the `web-test-runner` subagent. Do NOT drive the browser,
start the dev server, or run Playwright yourself in this session** — the whole
point is that browser noise (DOM dumps, console floods, MCP tool schemas) stays
inside the subagent's context.

Spawn it with the `Agent` tool, `subagent_type: web-test-runner`, running in the
current project directory. Pass along any hint the user gave (a URL, a port, or
which flow to check). If there is no hint, tell the subagent to auto-discover and
test the main page's golden path.

Example prompt to the subagent:
> Smoke-test this project in a browser. <hint, if any>. Discover how the app
> starts, bring up the dev server if it isn't running, drive the golden path,
> watch console/network, save artifacts under reports/qa/, and return the compact
> VERDICT block.

## What to relay back

The subagent returns ONE compact `VERDICT` block (PASS/FAIL + artifact paths).
Relay that to the user as-is. Do not re-open the browser or re-read the raw logs
yourself — if the user wants detail, point them at the artifacts dir the subagent
reported. Only re-spawn the subagent if the user asks to re-test.

## Scope

Lightweight smoke only: discover → serve → drive → observe → verdict. This is NOT
a full QA / security pass (that's the `security-auditor` agent). The browser
driver is auto-detected inside the subagent: Chrome DevTools MCP if registered in
the project, otherwise `npx playwright` CLI. The skill never installs any MCP.
