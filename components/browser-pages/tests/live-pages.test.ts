import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { livePage, livePagesFile, publishLivePage, recordWorkplaceFocus, workplaceFocused } from "../src/live-pages.js";

const agent = mkdtempSync(join(tmpdir(), "live-pages-"));
beforeAll(() => vi.stubEnv("PI_CODING_AGENT_DIR", agent));
afterAll(() => {
	vi.unstubAllEnvs();
	rmSync(agent, { recursive: true, force: true });
});

test("a page is findable by its session and tool call while it is open, and gone once closed", () => {
	const closeReview = publishLivePage("session-a", "call-1", { tool: "sign_off_code", url: "http://127.0.0.1:1/?t=a" });
	const closeExplain = publishLivePage("session-a", "call-2", {
		tool: "explain_change",
		url: "http://127.0.0.1:2/?t=b",
	});
	expect(livePage("session-a", "call-1", agent)).toEqual({ tool: "sign_off_code", url: "http://127.0.0.1:1/?t=a" });
	expect(livePage("session-b", "call-1", agent)).toBeUndefined();
	closeReview();
	expect(livePage("session-a", "call-1", agent)).toBeUndefined();
	expect(livePage("session-a", "call-2", agent)?.tool).toBe("explain_change");
	closeExplain();
	expect(livePage("session-a", "call-2", agent)).toBeUndefined();
});

test("Workplace counts as focused only while its window says so and its process lives", () => {
	expect(workplaceFocused(agent)).toBe(false);
	recordWorkplaceFocus(true, agent);
	expect(workplaceFocused(agent)).toBe(true);
	recordWorkplaceFocus(false, agent);
	expect(workplaceFocused(agent)).toBe(false);
	const file = join(agent, "agent-workplace", "focus.json");
	writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 7 }));
	expect(workplaceFocused(agent)).toBe(false);
	rmSync(file);
});

test("pages left behind by a process that has exited are not offered", () => {
	const file = livePagesFile("session-c", agent);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 7, pages: { "call-9": { tool: "sign_off_task", url: "x" } } }));
	expect(livePage("session-c", "call-9", agent)).toBeUndefined();
});
