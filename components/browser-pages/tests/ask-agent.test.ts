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
import { buildCodeReviewPage } from "../src/code-review.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const fn of cleanup.splice(0)) fn();
});

const lastText = (context: Context) => JSON.stringify(context.messages.at(-1));

it("answers a reviewer's question from a read-only fork of the live conversation", async () => {
	const repo = mkdtempSync(join(tmpdir(), "browser-pages-ask-"));
	cleanup.push(() => rmSync(repo, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
	git("init", "-q", "-b", "main");
	git("config", "user.email", "t@e.com");
	git("config", "user.name", "T");
	writeFileSync(join(repo, "a.ts"), "export const limit = 3;\n");
	git("add", ".");
	git("commit", "-q", "-m", "base");
	writeFileSync(join(repo, "a.ts"), "export const limit = 5;\n");

	let answer: string | undefined;
	const reviewer: ExtensionFactory = (pi) => {
		trackLiveSessions();
		pi.registerTool({
			name: "review",
			label: "Review",
			description: "Stands in for review_code while its page is open",
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
				answer = await askAgent(
					ctx,
					page,
					{ hunk, start: added, end: added, question: "Why five?" },
					new AbortController().signal,
				);
				return { content: [{ type: "text", text: "reviewed" }], details: {} };
			},
		});
	};
	const run = await fauxSession(
		[reviewer],
		(context) => {
			// The fork tries a write; it may run only read-only tools, so it gets a refusal and answers anyway.
			if (lastText(context).includes("Why five?"))
				return fauxAssistantMessage(fauxToolCall("bash", { command: "touch escaped.txt" }, { id: "fork-bash" }), {
					stopReason: "toolUse",
				});
			if (lastText(context).includes("fork-bash"))
				return fauxAssistantMessage("Five covers the upstream's retry window.");
			if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("done");
			return fauxAssistantMessage(fauxToolCall("review", {}, { id: "review-call" }), { stopReason: "toolUse" });
		},
		["review", "read", "bash"],
		{ cwd: repo },
	);
	cleanup.push(run.dispose);
	await run.session.prompt("review it");

	expect(answer).toBe("Five covers the upstream's retry window.");
	const fork = run.requests.find((request) => lastText(request).includes("Why five?"))!;
	expect(fork.messages.at(-2)).toMatchObject({ role: "toolResult", toolCallId: "review-call", isError: true });
	expect(lastText(fork)).toContain("a.ts:1");
	expect(lastText(fork)).toContain("+export const limit = 5;");
	expect(existsSync(join(repo, "escaped.txt"))).toBe(false);
	expect(JSON.stringify(run.requests.at(-1)!.messages)).not.toContain("Why five?");
});
