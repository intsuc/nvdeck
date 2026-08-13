## Skill Loading

Before editing files for a substantial task:

- Run `vpx @tanstack/intent@latest list` from the workspace root to see
  available local skills.
- If a listed skill matches the task, run
  `vpx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the
  workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or
  concern you are changing; load additional skills only when the task spans
  multiple packages or concerns.

## Development

Discard conventional human software-development thinking. Treat development as a
continuous sequence of turns within the current session.

Never divide development into `v0`, `0.1`, `1.0`, `MVP`, or any other version
boundary. Use the turn, not the version, as the unit of development.

### Multi-Turn Changes

Before starting a software change that is expected to require more than one
turn, use the goal feature to create one objective with a verifiable stopping
condition. Preserve the per-turn invariant throughout the goal.

### Per-Turn Invariant

Use every turn to make complete changes to the software.

End every turn with usable software. Never leave any software change partially
implemented.

### Complexity Defaults

Before adding compatibility behavior or a fallback, identify an explicit
requirement in the current task, governing project instructions or
specification, or a mandatory external contract.

- If a requirement exists, implement only its stated scope. Make each fallback's
  trigger and alternative behavior explicit and test them.
- Otherwise, implement exactly the current contract:
  - Do not add backward compatibility for superseded APIs, inputs,
    configuration, data formats, or behavior.
  - Do not add forward compatibility for hypothetical future versions, fields,
    enum values, capabilities, or environments.
  - Do not add implicit fallbacks. When the intended path cannot proceed, return
    a clear, actionable error instead of silently choosing another path, using
    stale or guessed data, or substituting an empty or null result.

When a requested change replaces a contract, migrate all in-scope callers,
tests, documentation, and persisted data in the same turn, then remove the old
aliases, adapters, version branches, dual reads, and dual writes. Use an
explicit one-time data migration when necessary; do not continue supporting the
old format at runtime.

Treat a default value declared by the current contract as normal behavior, not a
fallback. Treat explicitly supported targets and capabilities as the current
contract, not forward compatibility. Do not infer a compatibility requirement
solely from legacy code.

These defaults prevent speculative branches and hidden behavior from
accumulating in the codebase.

## Application UI

Treat every rule below as a hard constraint. Evaluate each screen and component
with these gates in order; revise any result that fails a gate.

### Decision Gates

1. **Content gate:** Does the UI display the application name or describe what
   the application is or does? Remove it. Show only content and labels required
   for the user's current task; self-identification consumes attention without
   advancing that task.
2. **Element-source gate:** When the project uses an existing UI system, inspect
   every custom UI element before creating or retaining it. If a provided
   element or supported composition satisfies the same role and interaction
   requirements, use it. Create a custom element only for requirements the
   system cannot satisfy, and reuse provided elements for every part they can
   supply. Reusing established elements preserves consistent behavior and
   interaction patterns across the application.
3. **Styling-source gate:** When the project uses an existing UI system, inspect
   every custom style before adding or retaining it. If the system provides a
   styling option that satisfies the same requirement, use it. A mechanism for
   authoring styles does not make those styles provided by the system.
   Otherwise, limit the custom style to the unmet requirement and follow the
   system's existing values and conventions. Keeping one primary styling system
   preserves consistency across the application.
4. **Corner gate:** Inspect every container, control, overlay, image, and
   decorative shape. Make every corner sharp. Never use rounded corners, pills,
   or capsules. Sharp geometry keeps boundaries and alignment explicit instead
   of adding decorative softness that communicates no task information.
5. **Decoration gate:** For every decorative treatment, name the UX information
   it communicates, such as function, state, hierarchy, or spatial relationship.
   If it communicates none, remove it; decoration must carry information rather
   than merely consume attention.
6. **Color gate:** Assign each non-neutral color one stable semantic meaning.
   Use the same color for the same meaning, and never reuse it for a conflicting
   meaning. If the mapping cannot remain consistent, remove the accent or use
   neutral styling; color improves UX only when its meaning is predictable.
7. **Shadow gate:** Add a shadow only when an element physically sits above or
   overlaps another element, and use the shadow to communicate that elevation.
   Remove shadows from elements on the same plane; a shadow improves UX only
   when it explains spatial layering.

### Final Check

Before delivering the UI, inspect every screen and component against all
applicable gates in order. Do not finish until every applicable gate passes.
When an existing UI system is present, verify that every remaining custom
element or style is limited to

## Testing

Treat tests as debt, a rate-limiting constraint, a compromise, and the last
resort. They add authoring, execution, and maintenance costs while offering only
probabilistic protection.

Before writing, keeping, or recommending a test, apply these gates in order:

1. **Static-guarantee gate:** Can the property be guaranteed statically? If yes,
   use that guarantee and do not use a test for it. Continue only if the
   property cannot be guaranteed statically.
2. **Future-value gate:** Is the property worth protecting in the future? If no,
   do not test it. Continue only if future bugs affecting the property should be
   easier to detect.
3. **Purpose gate:** Is this test being added merely because something was
   implemented, so that a passing result can be cited as evidence that the
   implementation is correct? If yes, do not write it; passing examples do not
   prove current correctness. Write or keep a test only when its expected
   behavior is justified independently of the current implementation and it
   targets a concrete, plausible future bug or regression that it would make
   easier to detect.

Only write or retain a dynamic test when the candidate passes all three gates.

## Project Workflow

- Use Deno 2.9 or newer for dependency management and project tasks.
- Run `deno install` after dependency changes.
- Use `deno task dev`, `deno task check`, and `deno task compile` for development, validation, and executable builds.
