# Contributing to AI Dev Orchestrator

Thank you for your interest in contributing. This document covers the process for making changes, running tests, and submitting pull requests.

---

## Development principles

1. **Typed everything.** No `any` in production code. The protocol package is the single source of truth for all types — add new types there first.

2. **Test-driven.** Every subsystem has a corresponding `__tests__/` file. Write the test before the implementation.

3. **Adapters are isolated.** The orchestration core must never import directly from an agent adapter. All agent communication flows through the `AgentAdapter` interface.

4. **Events decouple subsystems.** If two subsystems need to communicate, use the `EventBus`. Direct method calls between subsystems (other than dependency injection) are a code smell.

5. **Git is the source of truth for code.** SQLite is for orchestration metadata only. Never store file contents in the database.

---

## Branch strategy

```
main            ← stable, tagged releases only
dev             ← integration branch, PRs merge here
feature/xxx     ← feature branches off dev
fix/xxx         ← bug fix branches off dev
```

---

## Making a change

### 1. Create a branch

```bash
git checkout dev
git pull
git checkout -b feature/my-feature
```

### 2. Make changes

Follow the coding standards below.

### 3. Run tests

```bash
pnpm test              # run all tests
pnpm --filter @ai-orch/core test   # run just the core tests
```

### 4. Type-check

```bash
pnpm typecheck
```

### 5. Submit a PR

- Base branch: `dev`
- Title: `feat: ...` / `fix: ...` / `chore: ...` (conventional commits)
- Description: What changed, why, and how to test it
- Link any related issues

---

## Coding standards

### TypeScript

```typescript
// ✅ Good: explicit types, early returns, descriptive names
async function selectBestAgent(task: Task, available: AgentId[]): Promise<AgentId> {
  if (available.length === 0) throw new Error(`No agents available for task ${task.id}`);
  const scored = await Promise.all(available.map(id => scoreAgent(id, task)));
  scored.sort((a, b) => b.total - a.total);
  return scored[0]!.agentId;
}

// ❌ Bad: implicit any, nested logic, unclear naming
async function pick(t: any, a: any[]) {
  let best;
  for (const x of a) {
    const s = await score(x, t);
    if (!best || s > best.s) best = { x, s };
  }
  return best?.x;
}
```

### File naming

- Classes: `PascalCase.ts` → `AgentRouter.ts`
- Tests: `PascalCase.test.ts` → `AgentRouter.test.ts`
- Utilities: `camelCase.ts` → `tokenUtils.ts`

### Comments

- Public class and method JSDoc: required
- Internal implementation: comment the *why*, not the *what*
- TODO/FIXME: always include a ticket reference or an explanation

### Error handling

```typescript
// ✅ Type-safe errors with context
throw new Error(`AgentRouter.selectBest: no agents available for task "${task.name}" (type: ${task.type})`);

// ❌ Swallowed errors
try { ... } catch { }  // never do this without re-throwing or logging

// ✅ Graceful degradation where appropriate
const metrics = await db.getAgentMetrics(id, type).catch(() => null);
const rate    = metrics?.success_rate ?? 0.7;  // use default when DB unavailable
```

---

## Adding a new subsystem

1. Create `packages/core/src/MySubsystem.ts`
2. Export it from `packages/core/src/index.ts`
3. Add a `__tests__/MySubsystem.test.ts` with at least:
   - Happy path tests
   - Error/edge case tests
   - Event emission verification (if it emits events)
4. Inject it into `OrchestratorCore` via constructor
5. Document it in the Architecture tab of `ai_orchestrator_architecture.html`

---

## Adding a new event type

1. Add the event name and payload type to `packages/protocol/src/events.ts`:
   ```typescript
   MY_NEW_EVENT: { sessionId: string; data: string };
   ```
2. Update `packages/core/src/sidecar.ts` to include it in the `ALL_EVENTS` array
3. Add the event to the CI test in `EventBus.test.ts`

---

## Test writing guide

### Unit tests (vitest)

```typescript
// packages/core/src/__tests__/MyThing.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MyThing } from '../MyThing.js';

describe('MyThing', () => {
  describe('methodName', () => {
    it('does X when Y', async () => {
      // Arrange
      const thing = new MyThing(mockDep);
      // Act
      const result = await thing.methodName(input);
      // Assert
      expect(result).toMatchObject({ expected: 'value' });
    });

    it('throws when Z', async () => {
      const thing = new MyThing(mockDep);
      await expect(thing.methodName(bad)).rejects.toThrow('descriptive message');
    });
  });
});
```

### Mock conventions

```typescript
// ✅ Typed mock objects — declare shape explicitly
const mockDb: Pick<Database, 'getAgentMetrics' | 'upsertAgentMetrics'> = {
  getAgentMetrics:    vi.fn().mockResolvedValue(null),
  upsertAgentMetrics: vi.fn().mockResolvedValue(undefined),
};

// ✅ Use vi.clearAllMocks() in beforeEach — never share mock state between tests
beforeEach(() => { vi.clearAllMocks(); });
```

---

## Commit message format

```
<type>(<scope>): <short description>

[optional body]

[optional footer: closes #123]
```

Types: `feat` · `fix` · `chore` · `docs` · `test` · `refactor` · `perf`

Scopes: `core` · `router` · `handoff` · `git` · `storage` · `ui` · `claude` · `codex` · `cursor` · `gemini`

Examples:
```
feat(router): add language-match signal to agent scoring
fix(handoff): extract decisions from multi-line agent output
docs(setup): add WSL2 installation notes
test(dag): add parallel execution timing test
```

---

## Release process (maintainers only)

```bash
# 1. Merge dev → main
git checkout main && git merge dev

# 2. Bump version
pnpm version patch|minor|major

# 3. Tag
git tag v0.x.y

# 4. Push — CI builds and signs the Tauri bundles
git push origin main --tags
```
