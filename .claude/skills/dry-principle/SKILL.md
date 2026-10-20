---
name: dry-principle
description: Applies the Don't Repeat Yourself principle to avoid code duplication and improve maintainability, without over-abstracting. Use when reviewing or writing code, refactoring duplicated logic or constants, or asked to "apply DRY" / check for copy-paste in this repo.
---

<!-- Adapted from the dry-principle skill (v1.1.0) in oimiragieo/agent-studio (MIT):
     https://github.com/oimiragieo/agent-studio/tree/main/.claude/skills/dry-principle
     Changes: frontmatter trimmed to Claude Code's fields; the agent-studio memory protocol replaced by
     "In this repo". -->

# Dry Principle Skill

<identity>
You are a coding standards expert specializing in dry principle.
You help developers write better code by applying established guidelines and best practices.
</identity>

<capabilities>
- Review code for guideline compliance
- Suggest improvements based on best practices
- Explain why certain patterns are preferred
- Help refactor code to meet standards
</capabilities>

<instructions>
When reviewing or writing code, apply these guidelines:

- Follow the DRY (Don't Repeat Yourself) Principle and Avoid Duplicating Code or Logic.
- Avoid writing the same code more than once. Instead, reuse your code using functions, classes, modules, libraries, or other abstractions.
- Modify code in one place if you need to change or update it.
</instructions>

<examples>
Example usage:
```
User: "Review this code for dry principle compliance"
Agent: [Analyzes code against guidelines and provides specific feedback]
```
</examples>

## Iron Laws

1. **NEVER** extract to a shared abstraction until you have at least 3 concrete instances of the same logic — premature extraction creates wrong abstractions that are harder to remove than the original duplication.
2. **ALWAYS** maintain a single source of truth for configuration values — the same constant or config value defined in two places will diverge and cause bugs.
3. **NEVER** apply DRY to coincidentally similar code that serves different purposes — coupling unrelated concepts through shared abstractions creates cascading change requirements.
4. **ALWAYS** prefer readability over DRY when the abstraction requires indirection that obscures what the code does — a small amount of duplication is often better than an obscure helper.
5. **NEVER** use copy-paste as a first resort for new similar functionality — always check whether an existing abstraction can be extended or parameterized first.

## Anti-Patterns

| Anti-Pattern                                            | Why It Fails                                                                             | Correct Approach                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Extracting on the second occurrence (Rule of Two)       | Two instances may be coincidentally similar; wrong abstraction is worse than duplication | Wait for the third occurrence before extracting; use the Rule of Three          |
| Coupling unrelated concepts through shared helpers      | Changes to one domain break the other; creates unexpected dependencies                   | Only extract when the shared logic genuinely represents the same domain concept |
| Over-abstracting to eliminate all apparent duplication  | Creates complex indirection that requires reading 3 files to understand 1 operation      | Prefer 3 readable duplicate lines over 1 inscrutable abstraction                |
| Same constant defined in multiple configuration files   | Values diverge silently; one-off changes cause hard-to-trace bugs                        | Single config module or environment variable; import everywhere                 |
| DRY applied to test code (reducing fixture duplication) | Test setup that's too DRY becomes hard to read in isolation                              | Tests should be self-contained; some duplication in test setup is acceptable    |

## In this repo

Before adding a helper or a constant, look for the existing one (law 5):

| What                                               | Where                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `fract`, `clamp01`, `smoothstep`, `lerpHue`, `hexToRgb` | `src/engine/math.ts`                                                                        |
| A Look slider's range and clamp (`clampLook`)      | `LOOK_RANGES` in `src/state/app-state.ts`                                                        |
| Intensity and the sliders it moves                 | `applyIntensity` in `src/state/look-slots.ts`                                                    |
| The Studio's number ranges, master-trim ranges     | `STUDIO_LIMITS` in `src/app/studio.ts`, `trimRange` in `src/app/live-slot.ts`                    |
| Anything both the server and the browser read: URLs, event names, body shapes | a `*-wire.ts` leaf: `src/assistant/settings-wire.ts`, `relay-wire.ts`, `src/remote/wire.ts`, `src/log/log-wire.ts` |
| JSON answers, event streams, request bodies (server) | `server/http.ts`                                                                               |
| POSTing JSON (browser)                             | `postJSON` in `src/app/http.ts`                                                                  |
| Saving to localStorage                             | `readJSON`, `writeJSON`, `debouncedWriter`, `QUICK_WRITE_MS` in `src/state/persistence.ts`       |
| "3 scenes" counts                                  | `plural` in `src/app/plural.ts`                                                                  |
| An overlay's ×                                     | `src/components/CloseButton.tsx`                                                                 |

Duplication that is on purpose (laws 3 and 4):

- **GLSL twins.** `src/scenes/header.ts` mirrors TypeScript helpers (`laser()`, the palette's hue walk) so shaders and controls agree. Their comments name the twin; change both.
- **Scene shaders** (`src/scenes/*.ts`) are examples people copy and edit, and user scenes are compiled against the shared header. Keep each scene readable on its own. Adding a function to `header.ts` can clash with one a stored user scene already defines, so don't move per-scene GLSL helpers into the header.
- **Test setup** (`*.test.ts`, `e2e/*.spec.ts`): per-spec helpers are fine; share only through `e2e/fixtures.ts` when a helper is genuinely the same fixture.
- **The fake app** (`src/app/fake-app.ts`) should call the controller's shared pieces (as it does with `clampLook` and `applyIntensity`), not copy their bodies.

Use the vocabulary in `GLOSSARY.md` when naming a shared helper, and check `docs/adr/` before merging two concepts an ADR keeps apart.

After a DRY refactor run `npm run lint`, `npm run typecheck` and `npm test`. Run `npm run test:e2e` when a component or shader changed.
