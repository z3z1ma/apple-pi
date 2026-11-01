import { expect, test } from "vitest";
import { coveredByReviewWait, reviewWaitReturned, startReviewWait } from "../src/review-waits.js";

test("milestone mail is covered while its review is waited on and after the wait returned that generation", () => {
	const plan = "review:review-a:1:plan:1";
	const outcome = "review:review-a:1:outcome";
	expect(coveredByReviewWait(outcome)).toBe(false);
	const stop = startReviewWait("review-a");
	expect(coveredByReviewWait(plan)).toBe(true);
	stop();
	expect(coveredByReviewWait(plan)).toBe(false);
	reviewWaitReturned("review-a", 1);
	expect(coveredByReviewWait(outcome)).toBe(true);
	expect(coveredByReviewWait("review:review-a:2:outcome")).toBe(false);
	expect(coveredByReviewWait("review:review-b:1:outcome")).toBe(false);
	expect(coveredByReviewWait("thread-message-id")).toBe(false);
	const again = startReviewWait("review-a");
	expect(coveredByReviewWait("review:review-a:comment:command-1")).toBe(false);
	again();
	expect(coveredByReviewWait(undefined)).toBe(false);
});
