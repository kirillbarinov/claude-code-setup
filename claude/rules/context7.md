# Context7 — When to Use

Use `mcp__context7__resolve-library-id` + `mcp__context7__query-docs` proactively, without an explicit user request.

**Activate when:**
- Writing code with any external library/framework (primary trigger)
- Creating or editing config files (vite, tailwind, prisma, next.config, etc.)
- Fast-moving frameworks (Next.js, Tailwind v4, React 19, etc.)
- Unfamiliar or rarely used library — always
- Question about API, syntax, or configuration options

**Do not activate when:**
- Pure business logic with no external dependencies
- Algorithms and data structures
- Refactoring existing code without new libraries
- Already fetched docs for this library in the current session (reuse them)
