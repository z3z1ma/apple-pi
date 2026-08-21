# Defense-in-Depth Validation

## Overview

When you fix a bug caused by invalid data, adding validation at one place feels sufficient. But that single check can be bypassed by different code paths, refactoring, or mocks.

**Core principle:** Fix the source, then add another validation boundary only when a demonstrated bypass path or high-cost invariant justifies it.

## When Multiple Layers Are Justified

A second check is useful when a real producer can bypass the first, when a trust boundary changes, or when failure cost warrants independent enforcement. Do not duplicate the same policy everywhere or add logging as if it were validation. Each added layer needs a production consumer, a concrete bypass or risk, and an executable check.

Possible layers include:

### Layer 1: Entry Point Validation
**Purpose:** Reject obviously invalid input at API boundary

```typescript
function createProject(name: string, workingDirectory: string) {
  if (!workingDirectory || workingDirectory.trim() === '') {
    throw new Error('workingDirectory cannot be empty');
  }
  if (!existsSync(workingDirectory)) {
    throw new Error(`workingDirectory does not exist: ${workingDirectory}`);
  }
  if (!statSync(workingDirectory).isDirectory()) {
    throw new Error(`workingDirectory is not a directory: ${workingDirectory}`);
  }
  // ... proceed
}
```

### Layer 2: Business Logic Validation
**Purpose:** Ensure data makes sense for this operation

```typescript
function initializeWorkspace(projectDir: string, sessionId: string) {
  if (!projectDir) {
    throw new Error('projectDir required for workspace initialization');
  }
  // ... proceed
}
```

### Layer 3: Environment Guards
**Purpose:** Prevent dangerous operations in specific contexts

```typescript
async function gitInit(directory: string) {
  // In tests, refuse git init outside temp directories
  if (process.env.NODE_ENV === 'test') {
    const normalized = normalize(resolve(directory));
    const tmpDir = normalize(resolve(tmpdir()));

    if (!normalized.startsWith(tmpDir)) {
      throw new Error(
        `Refusing git init outside temp dir during tests: ${directory}`
      );
    }
  }
  // ... proceed
}
```

### Layer 4: Temporary Redacted Instrumentation
**Purpose:** Distinguish a demonstrated evidence gap during investigation

```typescript
async function gitInit(directory: string) {
  logger.debug('git-init boundary', {
    correlationId: 'investigation-1',
    directoryPresent: directory.length > 0,
    directoryIsAbsolute: isAbsolute(directory),
    matchesExpectedRoot: directory.startsWith(expectedTestRoot),
  });
  // ... proceed
}
```

Remove the marker after localization unless an existing observability contract owns it. Never log raw paths, environments, payloads, credentials, personal data, or full stacks.

## Applying the Pattern

When you find a bug:

1. **Trace the data flow** — identify the origin, consumers, and actual trust boundaries.
2. **Fix the root cause** — preserve the accepted contract at its production owner.
3. **Test plausible bypasses** — determine whether another real path can avoid that fix.
4. **Add only justified boundaries** — for each extra check, name its consumer, bypass/risk, failure behavior, and focused test. Product choices such as retry, timeout, or user-facing error policy return to shaping unless already authoritative.

## Example from Session

Bug: Empty `projectDir` caused `git init` in source code

**Data flow:**
1. Test setup → empty string
2. `Project.create(name, '')`
3. `WorkspaceManager.createWorkspace('')`
4. `git init` runs in `process.cwd()`

**Four layers added:**
- Layer 1: `Project.create()` validates not empty/exists/writable
- Layer 2: `WorkspaceManager` validates projectDir not empty
- Layer 3: `WorktreeManager` refuses git init outside tmpdir in tests
- Layer 4: Temporary redacted boundary marker to localize the demonstrated gap

**Result:** All 1847 tests passed, bug impossible to reproduce

## Key Insight

In the example above, evidence showed several independent bypass paths, so several checks were warranted. That is an observed case, not a universal four-layer mandate. Stop when the source fix and justified boundary checks make the accepted invariant hold; speculative validation and permanent debug logging are not robustness.
