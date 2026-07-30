---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADRs and glossary) as we go.
disable-model-invocation: true
---

Run a `grilling` session, and in parallel actively build and sharpen the project's domain
model as the interview proceeds. This is the *active* discipline — challenging terms,
inventing edge-case scenarios, and writing the glossary and decisions down the moment they
crystallise. Merely reading `CONTEXT.md` for vocabulary doesn't count — this is for when
you're changing the model, not just consuming it.

## File structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points to
where each one lives:

```
/
├── CONTEXT-MAP.md
├── docs/
│   └── adr/              ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/     ← context-specific decisions
│   └── billing/
│       ├── CONTEXT.md
│       └── docs/adr/
```

Create files lazily — only when you have something to write. If no `CONTEXT.md` exists,
create one when the first term is resolved. If no `docs/adr/` exists, create it when the
first ADR is needed.

## During the session

**Challenge against the glossary.** When the user uses a term that conflicts with the
existing language in `CONTEXT.md`, call it out immediately. "Your glossary defines
'cancellation' as X, but you seem to mean Y — which is it?"

**Sharpen fuzzy language.** When the user uses vague or overloaded terms, propose a precise
canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are
different things."

**Discuss concrete scenarios.** When domain relationships come up, stress-test them with
specific scenarios that probe edge cases and force precision about the boundaries between
concepts.

**Cross-reference with code.** When the user states how something works, check whether the
code agrees. If you find a contradiction, surface it.

**Update CONTEXT.md inline.** When a term is resolved, update `CONTEXT.md` right there —
don't batch these up. `CONTEXT.md` should be totally devoid of implementation details: a
glossary and nothing else. Format:

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**: {A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**: A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

Be opinionated — when multiple words exist for the same concept, pick the best one and list
the others under `_Avoid_`. Keep definitions to one or two sentences, defining what a term
IS, not what it does. Only include terms specific to this project's context — general
programming concepts don't belong even if heavily used. Group under subheadings when natural
clusters emerge.

For multi-context repos, `CONTEXT-MAP.md` lists each context, where it lives, and how they
relate (e.g. which events flow between them).

**Offer ADRs sparingly.** Only offer to create one when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one
   for specific reasons

If any is missing, skip the ADR. Qualifying examples: architectural shape, integration
patterns between contexts, technology choices that carry lock-in, boundary/scope decisions,
deliberate deviations from the obvious path, constraints invisible in the code, rejected
alternatives worth remembering. ADRs live in `docs/adr/` as `0001-slug.md`, `0002-slug.md`,
etc. (scan for the highest existing number and increment). Template:

```md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it — an ADR can be a single paragraph. The value is in recording *that* a decision was
made and *why*, not in filling out sections. Only add Status frontmatter, Considered Options,
or Consequences when they add genuine value.
