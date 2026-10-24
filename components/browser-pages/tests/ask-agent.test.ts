import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, expect, it } from "vitest";

import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { trackLiveSessions } from "../../shared/src/forked-continuation.js";
import { askAgent } from "../src/ask-agent.js";
import { buildCodeReviewPage, questionPassage } from "../src/code-review.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const fn of cleanup.splice(0)) fn();
});

const lastText = (context: Context) => JSON.stringify(context.messages.at(-1));

it("answers a reviewer's question from a read-only fork of the live conversation", async () => {
	const repo = mkdtempSync(join(tmpdir(), "browser-pages-ask-"));
	cleanup.push(() => rmSync(repo, { recursive: true, force: true }));
	const sessionCwd = mkdtempSync(join(tmpdir(), "browser-pages-parent-"));
	cleanup.push(() => rmSync(sessionCwd, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
	git("init", "-q", "-b", "main");
	git("config", "user.email", "t@e.com");
	git("config", "user.name", "T");
	writeFileSync(join(repo, "a.ts"), "export const limit = 3;\n");
	git("add", ".");
	git("commit", "-q", "-m", "base");
	writeFileSync(join(repo, "a.ts"), "export const limit = 5;\n");
	writeFileSync(join(repo, "rationale.txt"), "Five covers the upstream's retry window.");
	writeFileSync(join(sessionCwd, "rationale.txt"), "Wrong checkout.");

	let answer: string | undefined;
	let rationale: string | undefined;
	const reviewer: ExtensionFactory = (pi) => {
		trackLiveSessions();
		pi.registerTool({
			name: "review",
			label: "Review",
			description: "Stands in for sign_off_code while its page is open",
			parameters: Type.Object({}),
			async execute(_id, _params, _signal, _onUpdate, ctx) {
				const { page } = await buildCodeReviewPage(
					{
						title: "Raise the limit",
						intent: "More attempts.",
						chapters: [
							{
								title: "Limit",
								kind: "core",
								attention: "high",
								brief: "b",
								changes: [{ summary: "s", file: "a.ts" }],
							},
						],
					},
					repo,
					"token",
				);
				const hunk = page.order[0];
				const added = page.hunks[hunk].lines.findIndex((l) => l.t === "+");
				const passage = questionPassage(page, { hunk, start: added, end: added, question: "Why five?" });
				answer = await askAgent(ctx, passage, "Why five?", new AbortController().signal, repo);
				return { content: [{ type: "text", text: "reviewed" }], details: {} };
			},
		});
	};
	const run = await fauxSession(
		[reviewer],
		(context) => {
			if (lastText(context).includes("Why five?")) {
				const root = lastText(context).includes(repo) ? repo : sessionCwd;
				return fauxAssistantMessage(fauxToolCall("read", { path: join(root, "rationale.txt") }, { id: "fork-read" }), {
					stopReason: "toolUse",
				});
			}
			if (lastText(context).includes("fork-read")) {
				const result = context.messages.at(-1)!;
				if (result.role === "toolResult")
					rationale = result.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
				// Read-only page questions must still refuse a write after reading the target checkout.
				return fauxAssistantMessage(fauxToolCall("bash", { command: "touch escaped.txt" }, { id: "fork-bash" }), {
					stopReason: "toolUse",
				});
			}
			if (lastText(context).includes("fork-bash")) return fauxAssistantMessage(rationale ?? "No rationale read.");
			if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
			return fauxAssistantMessage(fauxToolCall("review", {}, { id: "review-call" }), { stopReason: "toolUse" });
		},
		["review", "read", "bash"],
		{ cwd: sessionCwd },
	);
	cleanup.push(run.dispose);
	await run.session.prompt("review it");

	expect(answer).toBe("Five covers the upstream's retry window.");
	const fork = run.requests.find((request) => lastText(request).includes("Why five?"))!;
	expect(fork.messages.at(-2)).toMatchObject({ role: "toolResult", toolCallId: "review-call", isError: true });
	expect(lastText(fork)).toContain("a.ts:1");
	expect(lastText(fork)).toContain("+export const limit = 5;");
	expect(existsSync(join(repo, "escaped.txt"))).toBe(false);
	expect(existsSync(join(sessionCwd, "escaped.txt"))).toBe(false);
	expect(JSON.stringify(run.requests.at(-1)!.messages)).not.toContain("Why five?");
});
