import { describe, expect, it } from "vitest";
import { createActivityTracker, sanitizeHarnessActivity } from "../src/activity.js";

describe("harness activity sanitizer", () => {
	it("keeps role-local tool names and never includes model text", () => {
		expect(sanitizeHarnessActivity({ toolName: "read", turnCount: 1, toolCount: 1, activeToolCount: 1 })).toEqual({
			phase: "tool",
			toolName: "read",
			turnCount: 1,
			toolCount: 1,
			label: "reading…",
		});
		expect(
			sanitizeHarnessActivity({ toolName: "secret_payload", turnCount: 2, toolCount: 0, activeToolCount: 0 }).toolName,
		).toBeUndefined();
		const seen: unknown[] = [];
		const tracker = createActivityTracker(4, undefined, (activity) => seen.push(activity));
		tracker.callbacks.onTextDelta("SECRET_MODEL_TEXT", "SECRET_MODEL_TEXT");
		tracker.callbacks.onToolActivity({ type: "start", toolName: "read" });
		expect(JSON.stringify(seen)).not.toContain("SECRET_MODEL_TEXT");
		expect(seen[0]).toMatchObject({ toolName: "read", label: "reading…" });
	});
});
