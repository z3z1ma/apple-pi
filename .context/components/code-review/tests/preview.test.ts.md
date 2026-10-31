## file

Preview cleanup is observed through a test-owned TMPDIR, using the real filesystem and Git path. node:fs/promises has non-configurable ESM exports, so a direct vi.spyOn(rm) fails before exercising cleanup. Assert an empty scratch parent after success, failure and cancellation rather than mocking cleanup or inventing a production scratch-directory setting.

Coupled: components/code-review/src/preview.ts, components/code-review/src/capture.ts
Verify: components/code-review/tests/preview.test.ts
