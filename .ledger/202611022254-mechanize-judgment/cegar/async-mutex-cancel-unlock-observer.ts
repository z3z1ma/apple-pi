import * as assert from 'assert';
import Semaphore from '../src/Semaphore';
import { E_CANCELED } from '../src/errors';

suite('Cancellation unlock observers', () => {
    test('cancel notifies an existing observer when it removes the only blocking acquisition', async () => {
        const semaphore = new Semaphore(1);
        const heavy = semaphore.acquire(2, 0).then(
            () => { throw new Error('The overweight acquisition must remain queued'); },
            error => error
        );
        let notified = false;
        semaphore.waitForUnlock(1, 0).then(() => { notified = true; });

        semaphore.cancel();
        assert.strictEqual(await heavy, E_CANCELED);
        await semaphore.waitForUnlock(1, 0);
        assert.strictEqual(semaphore.getValue(), 1);
        assert.strictEqual(notified, true, 'the older observer must be notified when cancellation makes its weight eligible');
    });

    test('dispatching the unchanged value notifies the same eligible observer', async () => {
        const semaphore = new Semaphore(1);
        const heavy = semaphore.acquire(2, 0).catch(error => error);
        let notified = false;
        const waiting = semaphore.waitForUnlock(1, 0).then(() => { notified = true; });

        semaphore.cancel();
        assert.strictEqual(await heavy, E_CANCELED);
        semaphore.setValue(semaphore.getValue());
        await waiting;
        assert.strictEqual(notified, true);
        assert.strictEqual(semaphore.getValue(), 1);
    });
});
