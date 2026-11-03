# Semaphore.cancel() can strand an unlock observer behind a cancelled weighted acquisition

Repository: https://github.com/DirtyHairy/async-mutex

Status: not filed. The operator approved filing, but a check on 2026-11-03 found the defect already reported as [#94](https://github.com/DirtyHairy/async-mutex/issues/94) (2026-10-12). The maintainer acknowledged it, and fix PR [#95](https://github.com/DirtyHairy/async-mutex/pull/95), with a test, is open. Nothing more is needed from us. The counterexample-to-test experiment ([cegar-log.md](../cegar-log.md)) found this defect independently, so the finding is real but not new. The report below is kept as written for upstream.

Verified revision: `b0bb4c5aa0e42eb5ffc8d9342e56bb6de1b95554` (`async-mutex` 0.5.0).
Environment: Node 22.23.4, Mocha 10.3.0, ts-node 10.9.2, TypeScript 5.4.2, tslib 2.6.2; macOS.

## Expected behavior

The [README's waitForUnlock contract](https://github.com/DirtyHairy/async-mutex/blob/b0bb4c5aa0e42eb5ffc8d9342e56bb6de1b95554/README.md#L453-L455) says:

> The promise will resolve as soon as it is possible to `acquire` the semaphore with the given weight and priority.

With free value 1, an acquisition requesting weight 2 queues. An equal-priority unlock observer requesting weight 1 waits behind it. Cancelling that queued acquisition makes the observer eligible without requiring a permit release: there are no held permits in this example.

## Actual behavior and minimal test

The existing observer remains pending, while a fresh observer with the same weight and priority resolves. Save this as `test/cancel-unlock-observer.ts` in the repository; it uses the existing Mocha TDD/ts-node configuration:

```typescript
import * as assert from 'assert';
import Semaphore from '../src/Semaphore';
import { E_CANCELED } from '../src/errors';

suite('Cancellation unlock observers', () => {
    test('cancel notifies an observer whose weight becomes eligible', async () => {
        const semaphore = new Semaphore(1);
        const heavy = semaphore.acquire(2, 0).catch(error => error);
        let notified = false;
        semaphore.waitForUnlock(1, 0).then(() => { notified = true; });

        semaphore.cancel();
        assert.strictEqual(await heavy, E_CANCELED);
        await semaphore.waitForUnlock(1, 0);
        assert.strictEqual(semaphore.getValue(), 1);
        assert.strictEqual(notified, true);
    });
});
```

Run after installing development dependencies:

```sh
npx --yes --package=node@22.23.4 node --no-experimental-strip-types node_modules/mocha/bin/mocha.js test/cancel-unlock-observer.ts
```

The last assertion fails: `false !== true`. The test uses no timers, sleeps, mocks or private-field assertions. The cancelled acquisition and the fresh observer provide ordinary promise barriers before the assertion.

The retained [two-test reproduction](async-mutex-cancel-unlock-observer.ts) also includes a positive control: `setValue(getValue())` after cancellation resolves the earlier observer without increasing capacity. Executed with the existing semaphore suite, the result was **43 passing / 1 failing** in 16 ms: all 42 original semaphore tests and that positive control pass, while the new behavioral assertion fails.

## Cause and suggested fix

[`Semaphore.cancel`](https://github.com/DirtyHairy/async-mutex/blob/b0bb4c5aa0e42eb5ffc8d9342e56bb6de1b95554/src/Semaphore.ts#L82-L85) rejects queued acquisitions and clears `_queue`, but leaves `_weightedWaiters` unchanged. Eligibility depends on both the free value and queue-head priority. Removing the queue head can therefore make existing observers eligible without a release or value change to trigger `_drainUnlockWaiters`.

After cancellation removes the acquisition queue, notify newly eligible unlock observers using the existing waiter-draining logic. Preserve the available value and currently held permits. Add this case beside the existing cancellation and unlock-observer tests. **This suggested fix has not been applied or validated.**

A source-derived finite model found the same five-step ordering: initial value 1 -> queue weight 2 -> register observer weight 1 -> cancel acquisition -> fresh observer completes while the earlier observer remains pending. The implementation test, rather than the abstract model alone, establishes the reported behavior.
