import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { REVIEWER_SILENCE_MS, watchSilence } from "../src/review-attempt.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("a reviewer that keeps showing activity is never stopped", () => {
	const onSilent = vi.fn();
	let last = Date.now();
	const stop = watchSilence(() => last, onSilent);
	for (let minute = 0; minute < 120; minute++) {
		vi.advanceTimersByTime(60_000);
		last = Date.now();
	}
	expect(onSilent).not.toHaveBeenCalled();
	stop();
});

test("a reviewer silent for the limit is stopped once, within one check of the limit", () => {
	const onSilent = vi.fn();
	const started = Date.now();
	watchSilence(() => started, onSilent);
	vi.advanceTimersByTime(REVIEWER_SILENCE_MS - 1);
	expect(onSilent).not.toHaveBeenCalled();
	vi.advanceTimersByTime(30_000);
	expect(onSilent).toHaveBeenCalledTimes(1);
	vi.advanceTimersByTime(REVIEWER_SILENCE_MS * 4);
	expect(onSilent).toHaveBeenCalledTimes(1);
});

test("a turn that ended stops the watch", () => {
	const onSilent = vi.fn();
	const started = Date.now();
	const stop = watchSilence(() => started, onSilent);
	stop();
	vi.advanceTimersByTime(REVIEWER_SILENCE_MS * 2);
	expect(onSilent).not.toHaveBeenCalled();
});
