/**
 * Tests for the /pair extension (a persistent second model that reviews each
 * turn and injects advice). Mirrors review.test.mjs structure.
 *
 * Layers:
 *   1. pure logic        — severity helpers, backoff, terminal detection, arg
 *                          parsing, advisory/​delta formatting, primary-agent
 *                          protocol, AdviseTool dedup (no model/network/TUI)
 *   1b. runtime mechanics — always-hold + catch-up block: runTurnBlock branches
 *                          (stub runtime) and the real PairRuntime + stub
 *                          Agent (hold → reconfirm → deliver/drop, settle waits)
 *   2. real loader       — the extension registers through pi's loader
 *   3. render path        — the advisory renderer shows notes by severity
 *   4. pi harness (E2E)  — drive a real `pi --mode rpc` and verify a nit is
 *                          delivered at its turn boundary and triggers a turn. Gated
 *                          behind PAIR_E2E=1 (needs anthropic auth + network;
 *                          spawns pi with PAIR_NO_REVIEW so the pair model
 *                          never fires — only the deterministic `/pair test`
 *                          nit hook does; high-sev needs the runtime, covered in 1b).
 *
 * Run:  npm run test:pair              (fast, offline)
 *       PAIR_E2E=1 npm run test:pair (also the pi harness)
 */

import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = resolve(HERE, "../src");
const PI_BIN = execSync("command -v pi").toString().trim();
// PI_DIST overrides bin-based resolution (needed when `pi` is a wrapper script
// rather than a symlink into the install, e.g. pointing at a pi-mono checkout).
const DIST = process.env.PI_DIST ?? dirname(execSync(`readlink -f ${PI_BIN}`).toString().trim());

const { createExtensionRuntime, loadExtensions } = await import(`${DIST}/core/extensions/loader.js`);
const { createEventBus } = await import(`${DIST}/core/event-bus.js`);
const { CustomMessageComponent } = await import(`${DIST}/modes/interactive/components/custom-message.js`);
const { initTheme } = await import(`${DIST}/modes/interactive/theme/theme.js`);

// index.ts has @earendil-works/* value imports; reach its exported pure helpers
// through jiti with the same aliases pi's extension loader uses.
const piRequire = createRequire(`${DIST}/index.js`);
const jitiDir = dirname(piRequire.resolve("jiti/package.json"));
const { createJiti } = await import(`${jitiDir}/lib/jiti-static.mjs`);
// node_modules sits beside dist in an npm install, but is hoisted to the repo
// root in a pi-mono checkout — probe both.
const NM = [resolve(DIST, "..", "node_modules"), resolve(DIST, "..", "..", "..", "node_modules")].find((d) =>
	existsSync(join(d, "@earendil-works")),
);
const pkgEntry = (pkg) => resolve(NM, "@earendil-works", pkg, "dist/index.js");
const { Agent: CoreAgent } = await import(pkgEntry("pi-agent-core"));
const { EventStream } = await import(resolve(NM, "@earendil-works", "pi-ai", "dist/compat.js"));
const ALIAS = {
	"@earendil-works/pi-coding-agent": `${DIST}/index.js`,
	"@earendil-works/pi-agent-core": pkgEntry("pi-agent-core"),
	"@earendil-works/pi-tui": pkgEntry("pi-tui"),
	"@earendil-works/pi-ai": pkgEntry("pi-ai"),
	typebox: resolve(NM, "typebox", "build", "index.mjs"),
};
const jiti = createJiti(import.meta.url, { moduleCache: false, alias: ALIAS });
const A = await jiti.import(resolve(HERE, "../src/index.ts"));
const P = await jiti.import(resolve(HERE, "../../shared/src/model-profiles.ts"));

// formatTurnDelta returns a markdown string with verbatim (un-escaped) content.
const renderDelta = (o) => A.formatTurnDelta(o);

initTheme();

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ===========================================================================
// 1. pure logic
// ===========================================================================

test("isHighSeverity: only concern/blocker are held + reconfirmed", () => {
	assert.equal(A.isHighSeverity(undefined), false);
	assert.equal(A.isHighSeverity("nit"), false);
	assert.equal(A.isHighSeverity("concern"), true);
	assert.equal(A.isHighSeverity("blocker"), true);
});

test("nextBackoffMs: base, doubling, capped, guarded", () => {
	assert.equal(A.nextBackoffMs(0, 15000, 120000), 15000);
	assert.equal(A.nextBackoffMs(1, 15000, 120000), 30000);
	assert.equal(A.nextBackoffMs(2, 15000, 120000), 60000);
	assert.equal(A.nextBackoffMs(3, 15000, 120000), 120000);
	assert.equal(A.nextBackoffMs(4, 15000, 120000), 120000); // capped
	assert.equal(A.nextBackoffMs(-1, 15000, 120000), 15000); // negative guarded to base
	assert.equal(A.nextBackoffMs(0), 15000); // defaults
});

test("formatPairFooterText: Pair is default and Advisor work is visible", () => {
	assert.equal(A.formatPairFooterText(false, 0), "Pair: $0.00");
	assert.equal(A.formatPairFooterText(true, 0.02), "Pair (reviewing): $0.02");
	assert.equal(A.formatPairFooterText(false, 1.5), "Pair: $1.50");
	assert.equal(A.formatPairFooterText(false, 0.02, "advisor_running", 0.5), "Pair → Advisor: $0.52");
	assert.equal(A.formatPairFooterText(false, 0.02, "escalation_pending", 0.5), "Pair (Advisor queued): $0.52");
	assert.equal(A.formatPairFooterText(false, 0.02, "delivery_pending", 0.5), "Pair (Advisor ready): $0.52");
});

test("isTerminalTurn: terminal iff the assistant message made no tool calls", () => {
	assert.equal(A.isTerminalTurn({ content: [{ type: "text" }] }), true);
	assert.equal(A.isTerminalTurn({ content: [] }), true);
	assert.equal(A.isTerminalTurn(undefined), true);
	assert.equal(A.isTerminalTurn({ content: [{ type: "toolCall" }] }), false);
	assert.equal(A.isTerminalTurn({ content: [{ type: "text" }, { type: "toolCall" }] }), false);
});

test("isLowSignalTurn: read-only is low-signal; user/error/mutation/command are not", () => {
	assert.equal(A.isLowSignalTurn({}), true);
	assert.equal(A.isLowSignalTurn({ toolResults: [{ toolName: "read", isError: false }] }), true);
	assert.equal(A.isLowSignalTurn({ hasUserText: true, toolResults: [{ toolName: "read" }] }), false);
	assert.equal(A.isLowSignalTurn({ toolResults: [{ toolName: "read", isError: true }] }), false);
	assert.equal(A.isLowSignalTurn({ toolResults: [{ toolName: "edit", isError: false }] }), false);
	assert.equal(A.isLowSignalTurn({ toolResults: [{ toolName: "write", isError: false }] }), false);
	assert.equal(
		A.isLowSignalTurn({
			toolResults: [{ toolName: "apply_patch", isError: false, details: { diff: "- a\n+ b" } }],
		}),
		false,
	);
	assert.equal(
		A.isLowSignalTurn({ toolResults: [{ toolName: "bash", isError: false, details: { exitCode: 0 } }] }),
		false,
	);
	assert.equal(
		A.isLowSignalTurn({ toolResults: [{ toolName: "shell", isError: false, details: { exit_code: 1 } }] }),
		false,
	);
});

test("formatReconfirmPreamble: empty when nothing held, else lists held notes", () => {
	assert.equal(A.formatReconfirmPreamble([]), "");
	const p = A.formatReconfirmPreamble([
		{ note: "races on shared map", severity: "blocker" },
		{ note: "missing await", severity: "concern" },
	]);
	assert.match(p, /Things you flagged earlier/);
	assert.match(p, /call `share_note` again/);
	assert.match(p, /- \[BLOCKER\] races on shared map/);
	assert.match(p, /- \[CONCERN\] missing await/);
	assert.match(p, /\n---\n/); // separates preamble from the session update below
});

test("parsePairTestArgs: valid severities + multiword note", () => {
	assert.deepEqual(A.parsePairTestArgs("test nit be tidy"), { severity: "nit", note: "be tidy" });
	assert.deepEqual(A.parsePairTestArgs("test  concern   wrong path here"), {
		severity: "concern",
		note: "wrong path here",
	});
	assert.deepEqual(A.parsePairTestArgs("test BLOCKER STOP NOW"), { severity: "blocker", note: "STOP NOW" });
});

test("parsePairTestArgs: rejects bad input", () => {
	assert.equal(A.parsePairTestArgs("test"), null);
	assert.equal(A.parsePairTestArgs("test nit"), null); // no note
	assert.equal(A.parsePairTestArgs("test bogus hi"), null); // bad severity
	assert.equal(A.parsePairTestArgs("status"), null);
});

test("appendPrimaryPairPrompt: appends the protocol once and is idempotent", () => {
	const once = A.appendPrimaryPairPrompt("You are the coding agent.");
	assert.match(once, /^You are the coding agent\.\n\n/);
	assert.match(once, /<pair-protocol>/);
	assert.match(once, /<\/pair-protocol>/);
	assert.equal(A.appendPrimaryPairPrompt(once), once);
	assert.equal(A.appendPrimaryPairPrompt(""), A.PRIMARY_PAIR_PROTOCOL);
});

test("formatAdvisoryContent: wraps with severity + guidance, escapes XML", () => {
	const c = A.formatAdvisoryContent([{ note: "use <T> & stuff", severity: "concern" }]);
	assert.match(c, /<pair-note severity="concern" guidance="pause, consider, then use your judgment">/);
	assert.match(c, /use &lt;T&gt; &amp; stuff/);
	assert.match(c, /<\/pair-note>/);
});

test("formatAdvisoryContent: omits severity attr when absent (plain nit)", () => {
	const c = A.formatAdvisoryContent([{ note: "tidy up" }]);
	assert.doesNotMatch(c, /severity=/);
	assert.match(c, /<pair-note guidance=/);
});

test("formatAdvisoryContent: stale option tags advice as about an earlier step", () => {
	const c = A.formatAdvisoryContent([{ note: "rename", severity: "nit" }], { stale: true });
	assert.match(c, /context="raised about an earlier step"/);
	assert.doesNotMatch(A.formatAdvisoryContent([{ note: "rename", severity: "nit" }]), /context=/);
});

test("formatAdvisoryContent: finalAnswer appends self-contained-final-answer guidance", () => {
	const c = A.formatAdvisoryContent([{ note: "fix bug", severity: "blocker" }], { finalAnswer: true });
	assert.match(c, /<\/pair-note>/);
	assert.match(c, /self-contained final answer/);
	assert.match(c, /do NOT write a terse follow-up/);
	// absent without the option
	assert.doesNotMatch(
		A.formatAdvisoryContent([{ note: "fix bug", severity: "blocker" }]),
		/self-contained final answer/,
	);
});

test("formatTurnDelta: includes user, thinking, text, tool call + result", () => {
	const md = renderDelta({
		userPrompt: "do the thing",
		assistant: {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "let me think" },
				{ type: "text", text: "here is my plan" },
				{ type: "toolCall", id: "1", name: "write", arguments: { path: "a.js" } },
			],
			usage: {},
			stopReason: "toolUse",
			timestamp: 1,
		},
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "1",
				toolName: "write",
				content: [{ type: "text", text: "wrote a.js" }],
				isError: false,
				timestamp: 2,
			},
		],
	});
	assert.match(md, /#### What the user told your partner\n\ndo the thing/);
	assert.match(md, /<thinking>\nlet me think\n<\/thinking>/);
	assert.match(md, /#### Your partner/);
	assert.match(md, /here is my plan/);
	assert.match(md, /→ tool `write`\(a\.js\) — 0 lines, 0 B; content omitted/);
	assert.match(md, /#### Tool result: `write`\n\ncall: 1\nwrote a\.js/);
});

test("formatTurnDelta: successful write omits content and addresses the result", () => {
	const body = "export function refresh() {\n  return rotate();\n}\n";
	const md = renderDelta({
		assistant: {
			role: "assistant",
			content: [{ type: "toolCall", id: "w1", name: "write", arguments: { path: "src/auth.ts", content: body } }],
			usage: {},
			stopReason: "toolUse",
			timestamp: 1,
		},
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "w1",
				toolName: "write",
				content: [{ type: "text", text: "Successfully wrote 48 bytes to src/auth.ts" }],
				isError: false,
				timestamp: 2,
			},
		],
	});
	assert.match(md, /→ tool `write`\(src\/auth\.ts\) — 3 lines/);
	assert.match(md, /content omitted/);
	assert.match(md, /call: w1/);
	assert.ok(!md.includes("export function refresh"), "write content must not appear in the delta");
});

test("formatTurnDelta: failed write keeps a truncated attempted body", () => {
	const body = `${"line\n".repeat(80)}secret-needle`;
	const md = renderDelta({
		assistant: {
			role: "assistant",
			content: [{ type: "toolCall", id: "w2", name: "write", arguments: { path: "huge.ts", content: body } }],
			usage: {},
			stopReason: "toolUse",
			timestamp: 1,
		},
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "w2",
				toolName: "write",
				content: [{ type: "text", text: "Error: disk full" }],
				isError: true,
				timestamp: 2,
			},
		],
	});
	assert.match(md, /→ tool `write`:/);
	assert.match(md, /path: huge\.ts/);
	assert.match(md, /truncated/);
	assert.match(md, /`write` \(error\)/);
	assert.ok(!md.includes("secret-needle"), "failed write content is capped");
});

test("formatUserBash: receipt without body, omitted when excluded", () => {
	const ok = A.formatUserBash({ command: "pnpm test auth", output: "ok\n".repeat(50), exitCode: 0 });
	assert.match(ok, /#### User bash/);
	assert.match(ok, /\$ pnpm test auth/);
	assert.match(ok, /50 lines/);
	assert.ok(!ok.includes("ok\nok"), "successful user bash omits the body");
	assert.equal(A.formatUserBash({ command: "secret", output: "nope", exitCode: 0, excludeFromContext: true }), "");
});

test("bindBashAppendHook: pushes persisted bashExecution, not user messages", () => {
	const seen = [];
	const sm = {
		appendMessage(message) {
			this.last = message;
			return "id-1";
		},
	};
	const stop = A.bindBashAppendHook(sm, (message) => seen.push(message.command));
	assert.equal(sm.appendMessage({ role: "user", content: "hi" }), "id-1");
	assert.equal(sm.appendMessage({ role: "bashExecution", command: "pnpm test", output: "ok", exitCode: 0 }), "id-1");
	assert.equal(
		sm.appendMessage({
			role: "bashExecution",
			command: "secret",
			output: "x",
			exitCode: 0,
			excludeFromContext: true,
		}),
		"id-1",
	);
	assert.deepEqual(seen, ["pnpm test"]);
	stop();
	sm.appendMessage({ role: "bashExecution", command: "after", output: "", exitCode: 0 });
	assert.deepEqual(seen, ["pnpm test"]);
});

test("formatTurnDelta: a multi-line bash command rides verbatim (no \\n escaping)", () => {
	const cmd = "cat > /tmp/x <<'EOF'\nline one\nline two\nEOF";
	const md = renderDelta({
		assistant: {
			role: "assistant",
			content: [{ type: "toolCall", id: "1", name: "bash", arguments: { command: cmd } }],
			usage: {},
			stopReason: "toolUse",
			timestamp: 1,
		},
	});
	assert.ok(md.includes(cmd), "command preserved verbatim with REAL newlines");
	assert.ok(!md.includes("\\n"), "no literal backslash-n escapes (the bug this fixes)");
});

test("formatTurnDelta: edits render as compact header + result diff (no raw old/new blobs)", () => {
	const diff = "  10 unchanged\n- 11 bootstrap 0/0\n+ 11 bootstrap 0.045% (9/20000)\n  12 unchanged";
	const md = renderDelta({
		assistant: {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "1",
					name: "edit",
					arguments: {
						path: "RESULTS.md",
						edits: [
							{ oldText: "bootstrap 0/0", newText: "bootstrap 0.045% (9/20000)" },
							{ oldText: "x", newText: "y" },
						],
					},
				},
			],
			usage: {},
			stopReason: "toolUse",
			timestamp: 1,
		},
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "1",
				toolName: "edit",
				content: [{ type: "text", text: "Successfully replaced 2 block(s)." }],
				details: { diff },
				isError: false,
				timestamp: 2,
			},
		],
	});
	// compact toolCall header, not the raw {oldText,newText} JSON dump
	assert.ok(md.includes("→ tool `edit`(RESULTS.md) — 2 block(s); diff in tool result"));
	// the result body is the marked diff (with -/+ framing), not the success text
	assert.ok(md.includes("- 11 bootstrap 0/0"));
	assert.ok(md.includes("+ 11 bootstrap 0.045% (9/20000)"));
	// the stale pre-edit blob must NOT appear as an unannotated peer (only inside the diff, prefixed)
	assert.ok(!md.includes('"oldText"'));
	assert.ok(!md.includes("Successfully replaced"));
});

test("formatTurnDelta: a failed edit (no diff) keeps its attempted args for diagnosis", () => {
	const md = renderDelta({
		assistant: {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "9",
					name: "edit",
					arguments: { path: "f.py", edits: [{ oldText: "needle that did not match", newText: "x" }] },
				},
			],
			usage: {},
			stopReason: "toolUse",
			timestamp: 1,
		},
		// failed edit: error result, NO details.diff
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "9",
				toolName: "edit",
				content: [{ type: "text", text: "Error: oldText not found" }],
				isError: true,
				timestamp: 2,
			},
		],
	});
	assert.ok(md.includes("needle that did not match"), "attempted oldText must survive when there is no diff");
	assert.ok(!md.includes("diff in tool result"), "no compact/diff header without a diff");
	assert.ok(md.includes("`edit` (error)"), "the error is still shown");
});

test("formatTurnDelta: a multi-line failed edit preserves real newlines in old/new", () => {
	const oldText = "def foo():\n    return 1";
	const md = renderDelta({
		assistant: {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "9",
					name: "edit",
					arguments: { path: "f.py", edits: [{ oldText, newText: "def foo():\n    return 2" }] },
				},
			],
			usage: {},
			stopReason: "toolUse",
			timestamp: 1,
		},
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "9",
				toolName: "edit",
				content: [{ type: "text", text: "Error: not found" }],
				isError: true,
				timestamp: 2,
			},
		],
	});
	assert.ok(md.includes(oldText), "multi-line oldText preserved verbatim");
	assert.ok(!md.includes("def foo():\\n"), "no \\n escaping in failed-edit args");
});

test("formatTurnDelta: a multi-line string NESTED in a non-edits container survives verbatim", () => {
	// Locks the general principle behind dropping safeJson: newlines are preserved at
	// EVERY depth, not just for top-level string args or the special-cased `edits`.
	const script = "#!/bin/sh\nset -e\nrun foo";
	const md = renderDelta({
		assistant: {
			role: "assistant",
			content: [{ type: "toolCall", id: "1", name: "custom", arguments: { spec: { script, retries: 3 } } }],
			usage: {},
			stopReason: "toolUse",
			timestamp: 1,
		},
	});
	assert.ok(md.includes(script), "nested multi-line string rides verbatim (no JSON.stringify escaping)");
	assert.ok(!md.includes("set -e\\n"), "no \\n escaping at depth");
	assert.ok(md.includes("retries: 3"), "scalar siblings still rendered");
});

test("formatTurnDelta: an ERROR result with a diff keeps args + error text (untrusted diff dropped)", () => {
	const md = renderDelta({
		assistant: {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "7",
					name: "multiedit",
					arguments: { path: "g.py", edits: [{ oldText: "attempted needle", newText: "z" }] },
				},
			],
			usage: {},
			stopReason: "toolUse",
			timestamp: 1,
		},
		// a custom/hooked edit tool that errored but still carried a diff
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "7",
				toolName: "multiedit",
				content: [{ type: "text", text: "Error: partial apply rejected" }],
				details: { diff: "- 1 old\n+ 1 new" },
				isError: true,
				timestamp: 2,
			},
		],
	});
	assert.ok(md.includes("attempted needle"), "args kept on error even when a diff exists");
	assert.ok(md.includes("Error: partial apply rejected"), "error text shown, not replaced by the diff");
	assert.ok(!md.includes("+ 1 new"), "untrustworthy error-result diff is not shown");
	assert.ok(!md.includes("diff in tool result"), "no suppression header on an error result");
});

test("formatTurnDelta: observation receipts keep loci and counts, not bodies", () => {
	const big = "LINE\n".repeat(80);
	const readMd = renderDelta({
		assistant: {
			role: "assistant",
			content: [{ type: "toolCall", id: "1", name: "read", arguments: { path: "src/a.ts", offset: 10, limit: 80 } }],
			usage: {},
			stopReason: "toolUse",
			timestamp: 1,
		},
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "1",
				toolName: "read",
				content: [{ type: "text", text: `${big}\n\n[Showing lines 10-89 of 412. Use offset=90 to continue.]` }],
				details: { truncation: { truncated: true, truncatedBy: "lines", outputLines: 80, totalLines: 412 } },
				isError: false,
				timestamp: 2,
			},
		],
	});
	assert.match(readMd, /requested 10–89/);
	assert.match(readMd, /returned 10–89 of 412/);
	assert.match(readMd, /80 lines/);
	assert.ok(!readMd.includes("LINE\nLINE"), "read body is not in the delta");

	const grepMd = renderDelta({
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "2",
				toolName: "grep",
				content: [
					{
						type: "text",
						text: [
							"src/auth/session.ts:81: const token = refreshToken()",
							"src/auth/session.ts-82- return token",
							"src/auth/session.ts:104: store.delete(old)",
							"src/auth/refresh.ts:33: export function rotate()",
							"",
							"[100 matches limit reached. Use limit=200 for more]",
						].join("\n"),
					},
				],
				details: { matchLimitReached: 100 },
				isError: false,
				timestamp: 2,
			},
		],
	});
	assert.match(grepMd, /3 matches in 2 files/);
	assert.match(grepMd, /src\/auth\/session\.ts: 81, 104/);
	assert.match(grepMd, /src\/auth\/refresh\.ts: 33/);
	assert.match(grepMd, /truncated: 100 match limit/);
	assert.ok(!grepMd.includes("const token"), "grep source text is dropped");
	assert.ok(!grepMd.includes("return token"), "grep context lines are dropped");

	const names = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`).join("\n");
	const findMd = renderDelta({
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "3",
				toolName: "find",
				content: [{ type: "text", text: names }],
				isError: false,
				timestamp: 2,
			},
		],
	});
	assert.match(findMd, /30 paths/);
	assert.match(findMd, /src\/f0\.ts/);
	assert.match(findMd, /shown 20 of 30/);
	assert.ok(!findMd.includes("src/f20.ts"), "find listing is capped");

	const bashMd = renderDelta({
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "4",
				toolName: "bash",
				content: [{ type: "text", text: big }],
				details: { exitCode: 0 },
				isError: false,
				timestamp: 2,
			},
		],
	});
	assert.match(bashMd, /exit 0/);
	assert.match(bashMd, /80 lines/);
	assert.ok(!bashMd.includes("LINE\nLINE"), "successful bash body is omitted");
	assert.ok(!bashMd.includes("… truncated"), "successful bash is a receipt, not a prefix");

	const failBody = `${Array.from({ length: 40 }, (_, i) => `log ${i}`).join("\n")}\nError: boom\nCommand exited with code 1`;
	const bashErr = renderDelta({
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "5",
				toolName: "bash",
				content: [{ type: "text", text: failBody }],
				details: { exitCode: 1 },
				isError: true,
				timestamp: 2,
			},
		],
	});
	assert.match(bashErr, /\(error\)/);
	assert.match(bashErr, /… tail/);
	assert.match(bashErr, /Error: boom/);
	assert.ok(!bashErr.includes("log 0"), "bash failure keeps a tail, not the prefix");

	const userMd = renderDelta({ userPrompt: big });
	assert.ok(userMd.includes("LINE\nLINE"), "user text is not a result body");
});

test("formatTurnDelta: a failed read keeps the error text", () => {
	const md = renderDelta({
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "1",
				toolName: "read",
				content: [{ type: "text", text: "Error: Offset 500 is beyond end of file (12 lines total)" }],
				isError: true,
				timestamp: 2,
			},
		],
	});
	assert.match(md, /Offset 500 is beyond end of file/);
});

test("formatActiveSessionContext: user bash follows the same receipt rules", () => {
	const output = "ok\n".repeat(50);
	const context = A.formatActiveSessionContext([
		{
			type: "message",
			id: "b1",
			parentId: "root",
			timestamp: "2026-01-01T00:00:00.000Z",
			message: {
				role: "bashExecution",
				command: "npm test",
				output,
				exitCode: 0,
				cancelled: false,
				truncated: false,
				excludeFromContext: false,
				timestamp: 1,
			},
		},
	]);
	assert.match(context, /#### User bash/);
	assert.match(context, /50 lines/);
	assert.ok(!context.includes("ok\nok"), "successful user bash omits the body");
});

test("formatTurnDelta: marks tool errors", () => {
	const md = renderDelta({
		toolResults: [
			{
				role: "toolResult",
				toolCallId: "1",
				toolName: "bash",
				content: [{ type: "text", text: "boom" }],
				isError: true,
				timestamp: 2,
			},
		],
	});
	assert.match(md, /#### Tool result: `bash` \(error\)/);
});

test("formatTurnDelta: empty turn ⇒ empty string", () => {
	assert.equal(A.formatTurnDelta({}), "");
});

test("seed: recent users are current plus two completed requests, labeled as implementer-bound", () => {
	const requests = A.collectRecentUserRequests([
		{ type: "message", message: { role: "user", content: "first" } },
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
		{ type: "message", message: { role: "user", content: "second" } },
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
		{ type: "message", message: { role: "user", content: "third" } },
		{
			type: "message",
			message: { role: "assistant", content: [{ type: "toolCall", id: "1", name: "bash" }] },
		},
		{ type: "message", message: { role: "toolResult", content: "out" } },
		{ type: "message", message: { role: "user", content: "steer" } },
	]);
	assert.deepEqual(
		requests.map((r) => ({ texts: r.texts, prior: r.prior })),
		[
			{ texts: ["first"], prior: true },
			{ texts: ["second"], prior: true },
			{ texts: ["third", "steer"], prior: false },
		],
	);
	const built = A.buildPairSeed({
		entries: [{ type: "message", message: { role: "user", content: "do it" } }],
		rollingAdvice: [{ note: "watch the lock", severity: "concern", disposition: "delivered" }],
	});
	assert.match(built, /What the user told your partner/);
	assert.match(built, /do it/);
	assert.match(built, /\[CONCERN\] \[shared\] watch the lock/);
	assert.match(built, /addressed to your partner, not to you/);
});

test("seed: recent trajectory keeps last implementing-agent turns and user bash", () => {
	const older = Array.from({ length: A.RECENT_TRAJECTORY_TURNS }, (_, i) => ({
		type: "message",
		message: {
			role: "assistant",
			content: [{ type: "thinking", thinking: `stale think ${i}` }],
		},
	}));
	const entries = [
		{ type: "message", message: { role: "user", content: "old request" } },
		...older,
		{ type: "message", message: { role: "user", content: "ship it" } },
		{
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "check refresh" },
					{
						type: "toolCall",
						id: "e1",
						name: "edit",
						arguments: { path: "src/auth.ts", edits: [{ oldText: "a", newText: "b" }] },
					},
				],
			},
		},
		{
			type: "message",
			message: {
				role: "toolResult",
				toolCallId: "e1",
				toolName: "edit",
				content: [{ type: "text", text: "ok" }],
				details: { diff: "- a\n+ b" },
				isError: false,
			},
		},
		{
			type: "message",
			message: { role: "bashExecution", command: "pnpm test auth", output: "ok\n", exitCode: 0 },
		},
	];
	const trajectory = A.formatRecentTrajectory(entries);
	assert.match(trajectory, /## What your partner has been doing/);
	assert.match(trajectory, /check refresh/);
	assert.match(trajectory, /→ tool `edit`\(src\/auth\.ts\)/);
	assert.match(trajectory, /call: e1/);
	assert.match(trajectory, /#### User bash/);
	assert.ok(!trajectory.includes("stale think 0"), "older turns outside the tail are dropped");
	assert.ok(!trajectory.includes("old request"), "user text stays in the user-request section");
	const seeded = A.buildPairSeed({ entries });
	assert.match(seeded, /## What your partner has been doing/);
	assert.match(seeded, /What the user told your partner/);
});

test("compact hook reseeds and keeps no prior pair deltas", async () => {
	const result = await A.pairCompactResult(
		{ preparation: { tokensBefore: 12000 } },
		{
			entries: () => [{ type: "message", message: { role: "user", content: "ship it" } }],
			rollingAdvice: () => [],
		},
	);
	assert.equal(result.compaction.firstKeptEntryId, A.PAIR_RESEED_ENTRY_ID);
	assert.equal(result.compaction.tokensBefore, 12000);
	assert.match(result.compaction.summary, /ship it/);
});

test("compact hook includes recent trajectory in the reseed", async () => {
	const result = await A.pairCompactResult(
		{ preparation: { tokensBefore: 8000 } },
		{
			entries: () => [
				{ type: "message", message: { role: "user", content: "ship it" } },
				{
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "thinking", thinking: "keep this skeleton" }],
					},
				},
			],
			rollingAdvice: () => [],
		},
	);
	assert.match(result.compaction.summary, /## What your partner has been doing/);
	assert.match(result.compaction.summary, /keep this skeleton/);
});

test("compact hook keeps the reseed and stores an xAI item when compact succeeds", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => ({
		ok: true,
		json: async () => ({ output: [{ type: "compaction", id: "cmp_adv", encrypted_content: "enc" }] }),
		text: async () => "",
	});
	try {
		const result = await A.pairCompactResult(
			{
				preparation: {
					tokensBefore: 9000,
					messagesToSummarize: [{ role: "user", content: [{ type: "text", text: "old review" }] }],
					turnPrefixMessages: [],
				},
				branchEntries: [],
			},
			{
				entries: () => [{ type: "message", message: { role: "user", content: "ship it" } }],
				rollingAdvice: () => [],
			},
			{
				model: { provider: "xai", api: "openai-responses", id: "grok-4.6", baseUrl: "https://api.x.ai/v1" },
				modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k" }) },
			},
		);
		assert.equal(result.compaction.firstKeptEntryId, A.PAIR_RESEED_ENTRY_ID);
		assert.match(result.compaction.summary, /ship it/);
		assert.ok(!result.compaction.summary.includes("[xAI Server-Side Compaction"));
		assert.deepEqual(result.compaction.details.xaiCompaction, {
			type: "compaction",
			id: "cmp_adv",
			encrypted_content: "enc",
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("compact hook omits the parent fold from the reseed summary", async () => {
	const result = await A.pairCompactResult(
		{ preparation: { tokensBefore: 1000 } },
		{
			entries: () => [
				{ id: "m1", type: "message", message: { role: "user", content: "ship it" } },
				{
					id: "r1",
					type: "custom",
					customType: "notebook.reflections.recorded",
					data: {
						reflections: [
							{
								id: "abc123abc123",
								content: "Do not reimplement auth",
								supportingObservationIds: ["m1"],
								tokenCount: 4,
							},
						],
						coversUpToId: "m1",
					},
				},
			],
			rollingAdvice: () => [],
		},
	);
	assert.match(result.compaction.summary, /ship it/);
	assert.ok(!result.compaction.summary.includes("Do not reimplement auth"));
	assert.ok(!result.compaction.summary.includes("## Current law"));
});

test("parent notebook packet sits after the compaction summary and is idempotent", () => {
	const packet = A.buildParentNotebookPacket([
		{ id: "m1", type: "message", message: { role: "user", content: "Build it" } },
		{
			id: "r1",
			type: "custom",
			customType: "notebook.reflections.recorded",
			data: {
				reflections: [
					{
						id: "abc123abc123",
						content: "Do not reimplement auth",
						supportingObservationIds: ["m1"],
						tokenCount: 4,
					},
				],
				coversUpToId: "m1",
			},
		},
	]);
	assert.ok(packet);
	assert.match(packet.content[0].text, /Do not reimplement auth/);
	assert.match(packet.content[0].text, /revisit_note/);
	assert.match(packet.content[0].text, /not a notebook for this side conversation/);
	assert.match(packet.content[0].text, /notebook you keep for your partner's session/);

	const first = A.insertParentNotebookAfterCompaction(
		[
			{ role: "compactionSummary", summary: "reseed" },
			{ role: "user", content: "next review" },
		],
		packet,
	);
	assert.equal(first.messages[0].role, "compactionSummary");
	assert.equal(first.messages[1].customType, "notebook.packet");
	assert.equal(first.messages[2].role, "user");

	assert.equal(A.insertParentNotebookAfterCompaction(first.messages, packet), undefined);
	assert.equal(A.insertParentNotebookAfterCompaction([{ role: "user", content: "no compact yet" }], packet), undefined);
});

test("pair parent-notebook hook does not register the notebook pipeline", () => {
	const events = [];
	const pi = {
		on(event) {
			events.push(event);
		},
	};
	A.registerPairParentNotebookPacket(pi, { getBranch: () => [] });
	assert.deepEqual(events, ["context"]);
});

test("runtime: a thrown first prompt keeps the seed for the retry", async () => {
	const prompts = [];
	let fail = true;
	const agent = {
		state: { messages: [] },
		async prompt(messages) {
			prompts.push(messages);
			if (fail) {
				fail = false;
				throw new Error("provider down");
			}
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	const rt = new A.PairRuntime(
		agent,
		new A.AdviseTool(() => false),
		0,
		undefined,
		undefined,
		undefined,
		() => "ORIENTATION-SEED",
	);
	rt.push("delta one", { terminal: true });
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(prompts.length, 2);
	assert.match(JSON.stringify(prompts[0]), /ORIENTATION-SEED/);
	assert.match(JSON.stringify(prompts[1]), /ORIENTATION-SEED/);
	rt.dispose();
});

test("Pair uses one fixed inference profile", () => {
	assert.equal(A.PAIR_MODEL_PROFILE, "pair");
});

test("default pair prompt names primary-bound recall tools", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pair-prompt-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const prompt = A.loadSystemPrompt(agentDir, false);
		assert.match(prompt, /revisit_note/);
		assert.match(prompt, /search_session/);
		assert.match(prompt, /your partner's transcript/);
		assert.match(prompt, /call:<id>/);
		assert.match(prompt, /You are pair programming with another capable coding agent/);
		assert.match(prompt, /Call `ask_advisor` instead/);
		assert.match(prompt, /Generic uncertainty.*keep them to yourself/);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("primary-bound revisit_note resolves the primary branch, not the caller ctx", async () => {
	const tools = A.bindPrimaryRecallTools({
		getSessionFile: () => undefined,
		getBranch: () => [
			{
				type: "message",
				id: "raw-1",
				timestamp: "2026-08-18T00:00:00.000Z",
				message: { role: "user", content: "exact primary lock wording" },
			},
			{
				type: "custom",
				id: "notebook-1",
				timestamp: "2026-08-18T00:00:01.000Z",
				customType: "notebook.observations.recorded",
				data: {
					observations: [
						{
							id: "aabbccddeeff",
							content: "lock lives in extension.ts",
							timestamp: "2026-08-18T00:00:00.000Z",
							relevance: "high",
							sourceEntryIds: ["raw-1"],
							tokenCount: 10,
						},
					],
					coversUpToId: "raw-1",
				},
			},
		],
		getEntries: () => [],
	});
	const notebook = tools.find((t) => t.name === "revisit_note");
	assert.ok(notebook);
	assert.match(notebook.description, /your partner's session/);
	for (const name of tools.map((t) => t.name)) {
		assert.ok(A.PAIR_SESSION_TOOLS.includes(name), `${name} must be on the session tool allowlist`);
	}
	const hit = await notebook.execute("c1", { id: "aabbccddeeff" }, undefined, undefined, {
		sessionManager: { getBranch: () => [] },
	});
	assert.match(hit.content[0].text, /exact primary lock wording/);
	const miss = await notebook.execute("c2", { id: "ffffffffffff" }, undefined, undefined, {
		sessionManager: { getBranch: () => [] },
	});
	assert.match(miss.content[0].text, /No observation or reflection/);
});

test("primary-bound search_session reads the primary session file, not the caller ctx", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pair-recall-"));
	const file = join(dir, "session.jsonl");
	writeFileSync(
		file,
		`${JSON.stringify({
			type: "message",
			id: "m1",
			message: { role: "user", content: "primary-only-token" },
		})}\n`,
	);
	try {
		const tools = A.bindPrimaryRecallTools({
			getSessionFile: () => file,
			getBranch: () => [{ id: "m1" }],
			getEntries: () => [{ id: "m1" }],
		});
		const search = tools.find((t) => t.name === "search_session");
		assert.ok(search);
		assert.match(search.description, /your partner's session/);
		const hit = await search.execute("c1", { query: "primary-only-token" }, undefined, undefined, {
			sessionManager: {
				getSessionFile: () => undefined,
				getBranch: () => [],
			},
		});
		assert.match(hit.content[0].text, /primary-only-token/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("buildReviewMessages: header turn + one single-block user turn per delta, content verbatim", () => {
	const d1 = A.formatTurnDelta({
		userPrompt: "u",
		assistant: {
			role: "assistant",
			content: [{ type: "toolCall", id: "1", name: "bash", arguments: { command: "echo hi\nls" } }],
			usage: {},
			stopReason: "toolUse",
			timestamp: 1,
		},
	});
	const d2 = A.formatTurnDelta({
		assistant: {
			role: "assistant",
			content: [{ type: "text", text: "done" }],
			usage: {},
			stopReason: "stop",
			timestamp: 3,
		},
	});
	const msgs = A.buildReviewMessages("", [d1, d2]);
	assert.equal(msgs.length, 3, "header turn + two delta turns");
	assert.ok(
		msgs.every((m) => m.role === "user"),
		"all user turns",
	);
	// Each message carries EXACTLY ONE text block: section separators are explicit in
	// the content, so model-visibility never depends on provider content-part joining.
	assert.ok(
		msgs.every((m) => Array.isArray(m.content) && m.content.length === 1 && m.content[0].type === "text"),
		"every message is a single text block",
	);
	assert.match(msgs[0].content[0].text, /### Session update/);
	// The explicit \n\n boundary between the #### User and #### Assistant sections must
	// be present in the block itself (the regression the reviewer flagged).
	assert.match(msgs[1].content[0].text, /#### What the user told your partner\n\nu\n\n#### Your partner/);
	assert.ok(msgs[1].content[0].text.includes("echo hi\nls"), "command rides verbatim");
});

test("formatActiveSessionContext: renders Pi's active context verbatim and excludes prior pair notes", () => {
	const bigResult = "RESULT-LINE\n".repeat(3000);
	const entries = [
		{
			type: "compaction",
			id: "c1",
			parentId: "old",
			timestamp: "2026-01-01T00:00:00.000Z",
			summary: "Keep the migration atomic.",
			firstKeptEntryId: "u1",
			tokensBefore: 50000,
		},
		{
			type: "message",
			id: "u1",
			parentId: "c1",
			timestamp: "2026-01-01T00:00:01.000Z",
			message: { role: "user", content: [{ type: "text", text: "Continue the migration." }], timestamp: 1 },
		},
		{
			type: "message",
			id: "a1",
			parentId: "u1",
			timestamp: "2026-01-01T00:00:02.000Z",
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "printf 'a\\nb'" } }],
				usage: {},
				stopReason: "toolUse",
				timestamp: 2,
			},
		},
		{
			type: "message",
			id: "t1",
			parentId: "a1",
			timestamp: "2026-01-01T00:00:03.000Z",
			message: {
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "bash",
				content: [{ type: "text", text: bigResult }],
				isError: false,
				timestamp: 3,
			},
		},
		{
			type: "branch_summary",
			id: "b1",
			parentId: "t1",
			timestamp: "2026-01-01T00:00:04.000Z",
			fromId: "other",
			summary: "The alternate branch rejected a global lock.",
		},
		{
			type: "message",
			id: "x1",
			parentId: "b1",
			timestamp: "2026-01-01T00:00:05.000Z",
			message: {
				role: "bashExecution",
				command: "print-private-state",
				output: "EXCLUDED-BASH-OUTPUT",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				excludeFromContext: true,
				timestamp: 5,
			},
		},
		{
			type: "custom_message",
			id: "n1",
			parentId: "x1",
			timestamp: "2026-01-01T00:00:06.000Z",
			customType: "advisory",
			content: "OLD-ADVISORY-MUST-NOT-REPLAY",
			display: true,
		},
	];
	const context = A.formatActiveSessionContext(entries);
	assert.match(context, /#### Compaction summary\n\nKeep the migration atomic\./);
	assert.match(context, /#### What the user told your partner\n\nContinue the migration\./);
	assert.ok(context.includes("printf 'a\\nb'"), "tool arguments remain verbatim");
	assert.match(context, /3000 lines/);
	assert.ok(!context.includes(bigResult), "active bash output is a receipt, not a body");
	assert.match(context, /#### Branch summary\n\nThe alternate branch rejected a global lock\./);
	assert.doesNotMatch(context, /EXCLUDED-BASH-OUTPUT/, "!! bash output stays outside pair context");
	assert.doesNotMatch(context, /OLD-ADVISORY-MUST-NOT-REPLAY/);
});

test("buildReviewMessages: re-prime context precedes but is distinct from the new update", () => {
	const messages = A.buildReviewMessages("", ["LATEST-ACTIVITY"], "PRIOR-ACTIVE-CONTEXT");
	assert.equal(messages.length, 3);
	assert.match(messages[0].content[0].text, /Active session context after history rewrite/);
	assert.match(messages[0].content[0].text, /PRIOR-ACTIVE-CONTEXT/);
	assert.match(messages[0].content[0].text, /do not raise advice solely about this historical context/);
	assert.match(messages[1].content[0].text, /### Session update/);
	assert.equal(messages[2].content[0].text, "LATEST-ACTIVITY");
});

test("the global Pair prompt and trusted project PAIR guidance have separate authority", async () => {
	const root = mkdtempSync(join(tmpdir(), "pair-trust-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(join(agentDir, "system-prompts"), { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		join(agentDir, "model-profiles.json"),
		JSON.stringify({ profiles: { pair: { model: "global-provider/global-model", thinking: "low" } } }),
	);
	writeFileSync(
		join(cwd, ".pi", "model-profiles.json"),
		JSON.stringify({ profiles: { pair: { model: "project-provider/project-model", thinking: "high" } } }),
	);
	writeFileSync(join(agentDir, "system-prompts", "pair.md"), "GLOBAL-PAIR-PROMPT");
	writeFileSync(join(cwd, "PAIR.md"), "PROJECT-PAIR-GUIDANCE");

	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const primaryModel = { provider: "global-provider", id: "global-model" };
		const resolved = P.resolveModelProfile("pair", {
			find: (provider, modelId) =>
				provider === primaryModel.provider && modelId === primaryModel.id ? primaryModel : undefined,
		});
		assert.equal(resolved.model, primaryModel, "a profile may intentionally select the primary model");
		assert.equal(resolved.thinking, "low");
		const untrustedPrompt = A.loadSystemPrompt(cwd, false);
		assert.match(untrustedPrompt, /^GLOBAL-PAIR-PROMPT/);
		assert.doesNotMatch(untrustedPrompt, /<ledger-workbench>/);
		assert.doesNotMatch(untrustedPrompt, /PROJECT-PAIR-GUIDANCE/);
		const trustedPrompt = A.loadSystemPrompt(cwd, true);
		assert.match(trustedPrompt, /^GLOBAL-PAIR-PROMPT/);
		assert.match(trustedPrompt, /PROJECT-PAIR-GUIDANCE/);
		assert.doesNotMatch(trustedPrompt, /<ledger-workbench>/);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}
});

test("AdviseTool: records, dedups, and escalates by severity rank", async () => {
	const calls = [];
	const tool = new A.AdviseTool((note, severity) => calls.push({ note, severity }));

	const r1 = await tool.execute("c1", { note: "guard empty array", severity: "nit" });
	assert.equal(calls.length, 1);
	assert.match(r1.content[0].text, /note was shared/);

	// exact duplicate (same text, same severity) is dropped
	const r2 = await tool.execute("c2", { note: "guard empty array", severity: "nit" });
	assert.equal(calls.length, 1);
	assert.match(r2.content[0].text, /equivalent note/);

	// whitespace-normalized duplicate also dropped
	await tool.execute("c3", { note: "guard   empty\narray", severity: "nit" });
	assert.equal(calls.length, 1);

	// escalation to a higher severity passes through
	await tool.execute("c4", { note: "guard empty array", severity: "concern" });
	assert.equal(calls.length, 2);
	assert.equal(calls[1].severity, "concern");

	// de-escalation back down is dropped
	await tool.execute("c5", { note: "guard empty array", severity: "nit" });
	assert.equal(calls.length, 2);

	// reset clears dedupe state ⇒ same note can be raised again
	tool.resetDelivered();
	await tool.execute("c6", { note: "guard empty array", severity: "nit" });
	assert.equal(calls.length, 3);
});

test("AdviseTool: held notes (onAdvice→false) stay unrecorded so they can re-fire", async () => {
	let deliver = false; // simulate "held" first, then "delivered"
	const calls = [];
	const tool = new A.AdviseTool((note, severity) => {
		calls.push({ note, severity });
		return deliver;
	});

	// first attempt held → tool reports held, dedup NOT recorded
	const r1 = await tool.execute("h1", { note: "data race", severity: "blocker" });
	assert.match(r1.content[0].text, /next safe moment/);
	assert.equal(r1.details.held, true);
	assert.equal(calls.length, 1);

	// same note re-raised while still held → onAdvice fires AGAIN (not deduped away)
	await tool.execute("h2", { note: "data race", severity: "blocker" });
	assert.equal(calls.length, 2);

	// now it gets delivered → recorded
	deliver = true;
	const r3 = await tool.execute("h3", { note: "data race", severity: "blocker" });
	assert.match(r3.content[0].text, /note was shared/);
	assert.equal(calls.length, 3);

	// once delivered, a same-severity repeat is deduped away
	await tool.execute("h4", { note: "data race", severity: "blocker" });
	assert.equal(calls.length, 3);
});

test("AdviseTool: markDelivered records dedup at the real delivery point", async () => {
	const calls = [];
	const tool = new A.AdviseTool((note, severity) => {
		calls.push({ note, severity });
		return false; // always held (high-severity path)
	});
	// the catch-up block delivers a held note, then records it:
	tool.markDelivered("data race", "blocker");
	// a later same-severity re-raise is now deduped before onAdvice fires
	const r = await tool.execute("x", { note: "data race", severity: "blocker" });
	assert.match(r.content[0].text, /equivalent note/);
	assert.equal(calls.length, 0);
	// but a genuine escalation past the recorded rank still passes
	const tool2 = new A.AdviseTool((note, severity) => {
		calls.push({ note, severity });
		return false;
	});
	tool2.markDelivered("flaky", "concern");
	await tool2.execute("y", { note: "flaky", severity: "blocker" });
	assert.equal(calls.length, 1);
});

// ===========================================================================
// 1b. runtime mechanics (offline, stub agent) — always-hold + catch-up block
//
// The hold/reconfirm/deliver flow needs the real runtime + a controllable
// pair, which a live E2E can't make deterministic (the /pair test hook
// bypasses the runtime entirely). So we drive runTurnBlock with a stub runtime,
// and the real PairRuntime with a stub Agent.
// ===========================================================================

// --- runTurnBlock orchestration, against a stub runtime ---
function stubRuntime({ held = [], settleResult = "settled" } = {}) {
	return {
		_held: [...held],
		waited: false,
		started: false,
		get hasHighPriority() {
			return this._held.some((n) => n.severity === "concern" || n.severity === "blocker");
		},
		startDrain() {
			this.started = true;
		},
		takeAllAdvice() {
			return this._held.splice(0);
		},
		requeueAdvice(note, severity) {
			this._held.push({ note, severity });
		},
		async waitUntilSettled() {
			this.waited = true;
			return settleResult;
		},
	};
}
const blockArgs = (over) => ({ consecutiveBlocks: 0, notify: () => {}, deliverHeld: () => {}, ...over });

test("runTurnBlock: non-terminal with nothing held → no block, streak resets", async () => {
	const rt = stubRuntime({ held: [] });
	const delivered = [];
	const n = await A.runTurnBlock(
		blockArgs({ terminal: false, runtime: rt, consecutiveBlocks: 3, deliverHeld: (x) => delivered.push(...x) }),
	);
	assert.equal(n, 0);
	assert.equal(rt.started, false, "must not force a deferred drain");
	assert.equal(rt.waited, false, "must not block");
	assert.equal(delivered.length, 0);
});

test("runTurnBlock: non-terminal with only queued nits does not block", async () => {
	const rt = stubRuntime({ held: [{ note: "small cleanup", severity: "nit" }] });
	assert.equal(await A.runTurnBlock(blockArgs({ terminal: false, runtime: rt })), 0);
	assert.equal(rt.waited, false, "nits are drained by boundary flush, not catch-up blocking");
});

test("runTurnBlock: non-terminal + held + settled → delivers survivors, resets streak", async () => {
	const delivered = [];
	const rt = stubRuntime({ held: [{ note: "x", severity: "blocker" }], settleResult: "settled" });
	const n = await A.runTurnBlock(
		blockArgs({ terminal: false, runtime: rt, consecutiveBlocks: 2, deliverHeld: (x) => delivered.push(...x) }),
	);
	assert.equal(n, 0);
	assert.deepEqual(delivered, [{ note: "x", severity: "blocker" }]);
});

test("runTurnBlock: non-terminal + held + timeout → keeps held, doubles streak", async () => {
	const delivered = [];
	const rt = stubRuntime({ held: [{ note: "x", severity: "blocker" }], settleResult: "timeout" });
	const n = await A.runTurnBlock(
		blockArgs({ terminal: false, runtime: rt, consecutiveBlocks: 1, deliverHeld: (x) => delivered.push(...x) }),
	);
	assert.equal(n, 2, "streak doubles via consecutiveBlocks+1");
	assert.equal(delivered.length, 0);
	assert.equal(rt.hasHighPriority, true, "held notes are kept, not taken");
});

test("runTurnBlock: terminal blocks unconditionally (even with nothing held)", async () => {
	const rt = stubRuntime({ held: [], settleResult: "settled" });
	const n = await A.runTurnBlock(blockArgs({ terminal: true, runtime: rt }));
	assert.equal(rt.started, true, "terminal catch-up must start drain before waiting");
	assert.equal(rt.waited, true, "terminal must block until the pair settles");
	assert.equal(n, 0);
});

test("runTurnBlock: never notifies an unresolved 'catching up'/'waiting up to' wait — the footer owns that signal", async () => {
	const notified = [];
	const notify = (msg) => notified.push(msg);

	await A.runTurnBlock(
		blockArgs({ terminal: true, runtime: stubRuntime({ held: [], settleResult: "settled" }), notify }),
	);
	await A.runTurnBlock(
		blockArgs({
			terminal: false,
			runtime: stubRuntime({ held: [{ note: "x", severity: "blocker" }], settleResult: "timeout" }),
			notify,
		}),
	);
	assert.equal(notified.length, 0, `expected no notify calls while waiting, got: ${JSON.stringify(notified)}`);

	// The timeout/failure outcome notify (a resolved, concrete result) still fires.
	const outcomeNotified = [];
	await A.runTurnBlock(
		blockArgs({
			terminal: true,
			runtime: stubRuntime({ held: [{ note: "x", severity: "concern" }], settleResult: "timeout" }),
			notify: (msg) => outcomeNotified.push(msg),
		}),
	);
	assert.equal(outcomeNotified.length, 1);
	assert.match(outcomeNotified[0], /didn't reconfirm in time/);
});

test("runTurnBlock: terminal timeout → delivers held best-effort (current, not stale)", async () => {
	const delivered = [];
	const rt = stubRuntime({ held: [{ note: "x", severity: "concern" }], settleResult: "timeout" });
	const n = await A.runTurnBlock(blockArgs({ terminal: true, runtime: rt, deliverHeld: (x) => delivered.push(...x) }));
	assert.equal(n, 0);
	assert.deepEqual(delivered, [{ note: "x", severity: "concern" }]);
});

test("runTurnBlock: passes { terminal } through to deliverHeld (settled + timeout paths)", async () => {
	// runTurnBlock must forward the turn's terminality to deliverHeld from both the
	// settled and timeout paths. deliverHeld derives final-answer guidance from the
	// turn lifecycle state and uses this value as a divergence-check invariant, so
	// this test pins the passthrough contract, not the guidance decision.
	const calls = [];
	const record = (notes, opts) => calls.push({ notes, opts });

	// terminal + settled → { terminal: true }
	await A.runTurnBlock(
		blockArgs({
			terminal: true,
			runtime: stubRuntime({ held: [{ note: "a" }], settleResult: "settled" }),
			deliverHeld: record,
		}),
	);
	// non-terminal + settled → { terminal: false }
	await A.runTurnBlock(
		blockArgs({
			terminal: false,
			runtime: stubRuntime({ held: [{ note: "b", severity: "concern" }], settleResult: "settled" }),
			deliverHeld: record,
		}),
	);
	// terminal + timeout (best-effort) → { terminal: true }
	await A.runTurnBlock(
		blockArgs({
			terminal: true,
			runtime: stubRuntime({ held: [{ note: "c", severity: "concern" }], settleResult: "timeout" }),
			deliverHeld: record,
		}),
	); // high-sev: a nit would stay held

	assert.equal(calls.length, 3);
	assert.equal(calls[0].opts?.terminal, true, "terminal settled → terminal:true");
	assert.equal(calls[1].opts?.terminal, false, "non-terminal settled → terminal:false");
	assert.equal(calls[2].opts?.terminal, true, "terminal timeout best-effort → terminal:true");
});

test("runTurnBlock: aborted (user Escape) → keeps held + streak, no delivery", async () => {
	const delivered = [];
	const rt = stubRuntime({ held: [{ note: "x", severity: "blocker" }], settleResult: "aborted" });
	const n = await A.runTurnBlock(
		blockArgs({ terminal: false, runtime: rt, consecutiveBlocks: 2, deliverHeld: (x) => delivered.push(...x) }),
	);
	assert.equal(n, 2, "streak preserved");
	assert.equal(delivered.length, 0);
	assert.equal(rt.hasHighPriority, true);
});

test("runTurnBlock: non-terminal + failed reconfirm → keeps held unconfirmed, backs off", async () => {
	// A failed reconfirm (pair errored out) must NOT deliver held notes as if
	// confirmed — same handling as a timeout.
	const delivered = [];
	const rt = stubRuntime({ held: [{ note: "x", severity: "blocker" }], settleResult: "failed" });
	const n = await A.runTurnBlock(
		blockArgs({ terminal: false, runtime: rt, consecutiveBlocks: 1, deliverHeld: (x) => delivered.push(...x) }),
	);
	assert.equal(n, 2, "backoff lengthens");
	assert.equal(delivered.length, 0, "unconfirmed held note is NOT delivered mid-run");
	assert.equal(rt.hasHighPriority, true);
});

test("runTurnBlock: terminal + failed reconfirm → best-effort delivers", async () => {
	const delivered = [];
	const rt = stubRuntime({ held: [{ note: "x", severity: "concern" }], settleResult: "failed" });
	const n = await A.runTurnBlock(blockArgs({ terminal: true, runtime: rt, deliverHeld: (x) => delivered.push(...x) }));
	assert.equal(n, 0);
	assert.deepEqual(delivered, [{ note: "x", severity: "concern" }], "last chance before idle → deliver best-effort");
});

test("runTurnBlock: terminal + timeout → only concerns/blockers ship best-effort; nits stay held", async () => {
	const delivered = [];
	const rt = stubRuntime({
		held: [
			{ note: "x", severity: "concern" },
			{ note: "y", severity: "nit" },
		],
		settleResult: "timeout",
	});
	const n = await A.runTurnBlock(blockArgs({ terminal: true, runtime: rt, deliverHeld: (x) => delivered.push(...x) }));
	assert.equal(n, 0);
	assert.deepEqual(
		delivered,
		[{ note: "x", severity: "concern" }],
		"only high severity is worth an unconfirmed delivery",
	);
	assert.deepEqual(
		rt._held,
		[{ note: "y", severity: "nit" }],
		"unconfirmed nit is re-held, not steered after the final answer",
	);
});

// --- real PairRuntime + stub Agent: hold → reconfirm → deliver/drop ---
// onReview(text, {tool, rt, reviewCount}) simulates the pair's reaction per review.
function buildIntegration({ onReview } = {}) {
	const delivered = [];
	let rt;
	let reviewCount = 0;
	// Mirrors the extension's turnState at turn_end while the catch-up block runs.
	const state = { turn: "ended-nonterminal" };
	const tool = new A.AdviseTool((note, severity) => {
		if (rt && !rt.acceptingAdvice) return false;
		rt.enqueueAdvice(note, severity); // production callback only enqueues
		return false;
	});
	const agent = {
		state: { messages: [], model: {} },
		async prompt(input) {
			// Defer like a real (multi-second, network) pair review: the hold must
			// land AFTER push()/turn_end returns, not synchronously inside it.
			await new Promise((r) => setTimeout(r, 0));
			reviewCount++;
			// prompt() now receives a batch of user messages (TextContent[] content);
			// flatten to the verbatim wire text the model would see so onReview can
			// assert on it (e.g. the reconfirm preamble).
			const text =
				typeof input === "string"
					? input
					: input
							.map((m) => (Array.isArray(m.content) ? m.content.map((b) => b.text ?? "").join("\n") : m.content))
							.join("\n\n");
			await onReview?.(text, { tool, rt, reviewCount });
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {
			this.state.messages = [];
		},
	};
	// mirrors the extension's boundary delivery + dedup recording
	const deliverHeld = (notes) => {
		for (const n of notes) {
			delivered.push({ ...n, kind: "held" });
			tool.markDelivered(n.note, n.severity);
		}
	};
	const flushNits = () => {
		for (const n of rt.takeNits()) {
			delivered.push({ ...n, kind: "nit", stale: true, finalAnswer: false });
			tool.markDelivered(n.note, n.severity);
		}
	};
	const onSettled = (outcome) => {
		if (outcome !== "ok") return;
		if (state.turn === "ended-terminal") deliverHeld(rt.takeAllAdvice());
		else if (state.turn === "ended-nonterminal") flushNits();
	};
	rt = new A.PairRuntime(agent, tool, 0, undefined, onSettled);
	const block = (terminal, opts = {}) => {
		state.turn = terminal ? "ended-terminal" : "ended-nonterminal";
		if (!terminal) flushNits();
		return A.runTurnBlock({ terminal, runtime: rt, consecutiveBlocks: 0, notify: () => {}, deliverHeld, ...opts });
	};
	return { rt, tool, delivered, deliverHeld, block, getReviewCount: () => reviewCount };
}

test("integration: a nit is delivered during review, not held, never blocks", async () => {
	const h = buildIntegration({
		onReview: async (_t, { tool, reviewCount }) => {
			if (reviewCount === 1) await tool.execute("n1", { note: "rename var", severity: "nit" });
		},
	});
	h.rt.push("turn 1");
	const cb = await h.block(false);
	await h.rt.waitUntilSettled(5000);
	assert.equal(cb, 0, "no block (nits never hold)");
	assert.equal(h.rt.hasHighPriority, false);
	assert.equal(h.delivered.length, 1);
	assert.equal(h.delivered[0].kind, "nit");
	// oracle: a mid-run inline nit is about an earlier/superseded step and carries no
	// restate (the agent hasn't returned a final answer this turn).
	assert.equal(h.delivered[0].stale, true, "mid-run inline nit is stale");
	assert.equal(h.delivered[0].finalAnswer, false, "mid-run inline nit does not restate");
});

test("integration: a queued nit enters terminal reconfirmation and surviving advice restates", async () => {
	let rt;
	const delivered = [];
	const tool = new A.AdviseTool((note, severity) => {
		rt.enqueueAdvice(note, severity);
		return false;
	});
	const agent = {
		state: { messages: [], model: {} },
		async prompt(input) {
			const text = input.map((m) => m.content.map((b) => b.text ?? "").join("\n")).join("\n\n");
			assert.match(text, /Things you flagged earlier/);
			assert.match(text, /queued race/);
			await tool.execute("reconfirm", { note: "queued race", severity: "nit" });
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	rt = new A.PairRuntime(agent, tool, 0);
	// Exact production boundary: the callback has queued a nit; terminal turn_end
	// leaves it in the shared queue before pushing/reviewing the final delta.
	rt.enqueueAdvice("queued race", "nit");
	rt.push("final turn");
	await A.runTurnBlock({
		terminal: true,
		runtime: rt,
		consecutiveBlocks: 0,
		notify: () => {},
		deliverHeld: (notes, opts) => delivered.push({ notes, opts }),
	});
	assert.deepEqual(delivered, [{ notes: [{ note: "queued race", severity: "nit" }], opts: { terminal: true } }]);
});

test("integration: terminal timeout requeue does not fake reconfirmation when late review recants", async () => {
	let release;
	let rt;
	const delivered = [];
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			await new Promise((resolve) => (release = resolve));
			// Silent successful review: offered nit is recanted.
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	const tool = new A.AdviseTool((note, severity) => {
		rt.enqueueAdvice(note, severity);
		return false;
	});
	rt = new A.PairRuntime(agent, tool, 0, undefined, (outcome) => {
		if (outcome === "ok") delivered.push(...rt.takeAllAdvice());
	});
	rt.enqueueAdvice("stale nit", "nit");
	rt.push("final turn");
	await A.runTurnBlock({
		terminal: true,
		runtime: rt,
		consecutiveBlocks: 0,
		capMs: 5,
		notify: () => {},
		deliverHeld: (notes) => delivered.push(...notes),
	});
	assert.deepEqual(delivered, [], "timeout does not deliver an unconfirmed nit");
	release();
	await rt.waitUntilSettled(2000);
	assert.deepEqual(delivered, [], "silent late review drops the nit instead of delivering it");
});

test("integration: terminal timeout delivers a nit that the late review genuinely re-raises", async () => {
	let release;
	let rt;
	let tool;
	const delivered = [];
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			await new Promise((resolve) => (release = resolve));
			await tool.execute("reraised", { note: "still valid", severity: "nit" });
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	tool = new A.AdviseTool((note, severity) => {
		rt.enqueueAdvice(note, severity);
		return false;
	});
	rt = new A.PairRuntime(agent, tool, 0, undefined, (outcome) => {
		if (outcome === "ok") delivered.push(...rt.takeAllAdvice());
	});
	rt.enqueueAdvice("still valid", "nit");
	rt.push("final turn");
	await A.runTurnBlock({
		terminal: true,
		runtime: rt,
		consecutiveBlocks: 0,
		capMs: 5,
		notify: () => {},
		deliverHeld: (notes) => delivered.push(...notes),
	});
	assert.deepEqual(delivered, []);
	release();
	await rt.waitUntilSettled(2000);
	assert.deepEqual(delivered, [{ note: "still valid", severity: "nit" }]);
});

test("integration: terminal turn — a nit from the lagging previous-turn review is held, reconfirmed by the final turn's review, then delivered", async () => {
	const h = buildIntegration({
		onReview: async (text, { tool, reviewCount }) => {
			if (reviewCount === 1) {
				// review of turn 1, emitted while the terminal turn 2 is already queued
				await tool.execute("n1", { note: "rename var", severity: "nit" });
			} else if (reviewCount === 2) {
				assert.match(text, /Things you flagged earlier/, "the held nit rides the final turn's reconfirm preamble");
				assert.match(text, /\[NIT\] rename var/);
				await tool.execute("n2", { note: "rename var", severity: "nit" }); // still applies
			}
		},
	});
	// Review 1 lags: turn 2's delta is queued before review 1's async prompt runs.
	h.rt.push("turn 1");
	h.rt.push("final turn");
	assert.equal(await h.block(true), 0);
	assert.equal(h.getReviewCount(), 2);
	assert.deepEqual(
		h.delivered,
		[{ note: "rename var", severity: "nit", kind: "held" }],
		"nit waits for the final turn's review, then lands as held",
	);
	assert.equal(h.rt.hasHighPriority, false);
});

test("integration: terminal turn — a lagging-review nit the final turn's review does NOT re-raise is dropped", async () => {
	const h = buildIntegration({
		onReview: async (_text, { tool, reviewCount }) => {
			if (reviewCount === 1) await tool.execute("n1", { note: "rename var", severity: "nit" });
			// review 2 (the final turn's) stays silent → the nit was addressed/superseded
		},
	});
	h.rt.push("turn 1");
	h.rt.push("final turn");
	assert.equal(await h.block(true), 0);
	assert.equal(h.getReviewCount(), 2);
	assert.equal(h.delivered.length, 0, "stale previous-turn nit is dropped, not steered after the final answer");
	assert.equal(h.rt.hasHighPriority, false);
});

test("integration: terminal turn — a nit from the final turn's OWN review lands at settle (no mid-review steer)", async () => {
	const h = buildIntegration({
		onReview: async (_text, { tool, reviewCount }) => {
			if (reviewCount === 1) await tool.execute("n1", { note: "rename var", severity: "nit" });
		},
	});
	h.rt.push("final turn"); // pair idle → the review includes the final turn (current, no reconfirm needed)
	assert.equal(await h.block(true), 0);
	assert.equal(h.getReviewCount(), 1, "no extra reconfirm review — the nit skips the prune and waits for settle");
	assert.deepEqual(h.delivered, [{ note: "rename var", severity: "nit", kind: "held" }]);
	assert.equal(h.rt.hasHighPriority, false);
});

test("integration (regression): a reconfirm-as-nit followed by a provider error survives the retry (no premature dedup)", async () => {
	// The de-escalating reconfirm (held blocker re-raised as a nit) must be
	// reported as HELD, not recorded as delivered: if the review then errors and
	// is retried, a recorded nit would be duplicate-dropped on the retry before it
	// can re-reconfirm, and the successful retry's prune would silently lose the
	// held blocker.
	const h = buildIntegration({
		onReview: async (_text, { tool, reviewCount }) => {
			if (reviewCount === 1) {
				await tool.execute("a1", { note: "off-by-one", severity: "blocker" });
			} else if (reviewCount === 2) {
				await tool.execute("a2", { note: "off-by-one", severity: "nit" }); // de-escalating reconfirm…
				throw new Error("provider blip"); // …then the review errors → retried
			} else if (reviewCount === 3) {
				await tool.execute("a3", { note: "off-by-one", severity: "nit" }); // retry must NOT be duplicate-dropped
			}
		},
	});
	h.rt.push("turn 1");
	await h.block(false);
	await h.rt.waitUntilSettled(5000);
	assert.equal(h.rt.hasHighPriority, true);
	h.rt.push("turn 2"); // NON-terminal: same-queue upsert reconfirms without de-escalating
	assert.equal(await h.block(false), 0);
	assert.equal(h.getReviewCount(), 3);
	assert.equal(h.delivered.length, 1, "held blocker survives the errored reconfirm's retry");
	assert.equal(h.delivered[0].severity, "blocker");
});

test("integration: blocker held on turn 1, survives reconfirm, delivered after terminal block", async () => {
	const h = buildIntegration({
		onReview: async (text, { tool, reviewCount }) => {
			if (reviewCount === 1) {
				await tool.execute("a1", { note: "off-by-one", severity: "blocker" });
			} else if (reviewCount === 2) {
				assert.match(text, /Things you flagged earlier/, "reconfirm preamble rides review 2");
				await tool.execute("a2", { note: "off-by-one", severity: "blocker" }); // still applies
			}
		},
	});
	// turn 1: non-terminal, nothing held yet → no block; review 1 holds the blocker
	h.rt.push("turn 1");
	assert.equal(await h.block(false), 0);
	await h.rt.waitUntilSettled(5000);
	assert.equal(h.rt.hasHighPriority, true);
	assert.equal(h.delivered.length, 0, "nothing delivered on the flagging turn");
	// turn 2: terminal → block until settled; review 2 reconfirms; survivor delivered
	h.rt.push("turn 2");
	assert.equal(await h.block(true), 0);
	assert.equal(h.getReviewCount(), 2);
	assert.equal(h.delivered.length, 1);
	assert.equal(h.delivered[0].kind, "held");
	assert.equal(h.delivered[0].severity, "blocker");
});

test("integration: a blocker first raised ON the terminal turn is caught + delivered (Q1)", async () => {
	// The pair flags for the first time while the terminal turn is blocked; the
	// agent did no follow-up (it's stopping), so it's delivered without a reconfirm.
	const h = buildIntegration({
		onReview: async (_text, { tool, reviewCount }) => {
			if (reviewCount === 1) await tool.execute("a1", { note: "leaks an fd", severity: "blocker" });
		},
	});
	h.rt.push("final turn");
	assert.equal(await h.block(true), 0, "terminal block waits for the review that raises the blocker");
	assert.equal(h.getReviewCount(), 1);
	assert.equal(h.delivered.length, 1, "blocker raised on the terminal turn lands before idle");
	assert.equal(h.delivered[0].kind, "held");
	assert.equal(h.delivered[0].severity, "blocker");
	assert.equal(h.rt.hasHighPriority, false);
});

test("integration (F1): advice from an orphaned review is dropped without poisoning fresh-epoch dedup", async () => {
	const h = buildIntegration({
		onReview: async (_t, { tool, rt, reviewCount }) => {
			if (reviewCount === 1) {
				rt.reset(); // orphan this review mid-flight (e.g. session compaction)
				await tool.execute("a1", { note: "same blocker", severity: "blocker" });
			} else if (reviewCount === 2) {
				// Same note in the fresh epoch must reach onAdvice; the stale callback must
				// not have been recorded as delivered by AdviseTool.
				const result = await tool.execute("a2", { note: "same blocker", severity: "blocker" });
				assert.doesNotMatch(result.content[0].text, /equivalent note/);
			}
		},
	});
	h.rt.push("turn 1");
	await h.block(false);
	await h.rt.waitUntilSettled(2000);
	assert.equal(h.rt.hasHighPriority, false, "orphaned review's hold is dropped");
	assert.equal(h.delivered.length, 0, "nothing delivered from a stale review");

	h.rt.push("fresh turn");
	await h.block(false);
	await h.rt.waitUntilSettled(2000);
	assert.equal(h.rt.hasHighPriority, true, "same blocker is accepted and held in fresh epoch");
});

test("integration (F2): a held blocker re-raised as a nit is kept, not de-escalated", async () => {
	const h = buildIntegration({
		onReview: async (_text, { tool, reviewCount }) => {
			if (reviewCount === 1) await tool.execute("a1", { note: "off-by-one", severity: "blocker" });
			else if (reviewCount === 2) await tool.execute("a2", { note: "off-by-one", severity: "nit" }); // de-escalation attempt
		},
	});
	h.rt.push("turn 1");
	await h.block(false);
	await h.rt.waitUntilSettled(5000);
	assert.equal(h.rt.hasHighPriority, true);
	h.rt.push("turn 2");
	assert.equal(await h.block(true), 0);
	assert.equal(h.delivered.length, 1, "no nit delivered; the held note survives");
	assert.equal(h.delivered[0].kind, "held");
	assert.equal(h.delivered[0].severity, "blocker", "kept at blocker severity, not lowered to nit");
});

test("integration: held blocker is dropped when the reconfirm review recants", async () => {
	const h = buildIntegration({
		onReview: async (_text, { tool, reviewCount }) => {
			if (reviewCount === 1) await tool.execute("a1", { note: "off-by-one", severity: "blocker" });
			// review 2: agent fixed it → pair stays silent → held note evaporates
		},
	});
	h.rt.push("turn 1");
	await h.block(false);
	await h.rt.waitUntilSettled(5000);
	assert.equal(h.rt.hasHighPriority, true);
	h.rt.push("turn 2");
	assert.equal(await h.block(true), 0);
	assert.equal(h.delivered.length, 0, "recanted blocker is dropped, not delivered");
	assert.equal(h.rt.hasHighPriority, false);
});

test("integration (regression): a held note survives push() and blocks + delivers mid-run", async () => {
	// Regression for the synchronous-#drain-splice bug: push() runs the drain up to
	// its first await, which must NOT empty the queue — otherwise a non-terminal
	// turn sees hasHighPriority=false and never blocks.
	const h = buildIntegration({
		onReview: async (text, { tool, reviewCount }) => {
			if (reviewCount === 1) await tool.execute("a1", { note: "races on cache", severity: "blocker" });
			else if (reviewCount === 2) {
				assert.match(text, /Things you flagged earlier/);
				await tool.execute("a2", { note: "races on cache", severity: "blocker" }); // still applies
			}
		},
	});
	h.rt.push("turn 1");
	await h.block(false);
	await h.rt.waitUntilSettled(5000);
	assert.equal(h.rt.hasHighPriority, true);
	// turn 2 is NON-terminal; the held note must keep hasHighPriority true across push
	h.rt.push("turn 2");
	assert.equal(h.rt.hasHighPriority, true, "held note survives push() (no mid-flight splice)");
	const cb = await h.block(false);
	assert.equal(h.delivered.length, 1, "prior queued blocker delivered at the non-terminal boundary");
	assert.equal(h.delivered[0].kind, "held");
	assert.equal(cb, 0, "settled → streak reset");
});

test("integration (regression): terminal timeout delivers a held note stuck mid-reconfirm", async () => {
	// Regression for Finding 2: pre-existing advice must remain queued while
	// its reconfirm review is in flight, so a terminal timeout can still deliver it.
	let releaseReview2;
	const h = buildIntegration({
		onReview: async (_text, { tool, reviewCount }) => {
			if (reviewCount === 1) await tool.execute("a1", { note: "fd leak", severity: "blocker" });
			else if (reviewCount === 2) await new Promise((r) => (releaseReview2 = r)); // hang past the timeout
		},
	});
	h.rt.push("turn 1");
	await h.block(false);
	await h.rt.waitUntilSettled(5000);
	assert.equal(h.rt.hasHighPriority, true);
	h.rt.push("turn 2");
	const cb = await h.block(true, { capMs: 30 }); // terminal, review 2 hangs → times out
	assert.equal(h.delivered.length, 1, "pre-existing held note delivered best-effort on terminal timeout");
	assert.equal(h.delivered[0].severity, "blocker");
	assert.equal(cb, 0);
	releaseReview2?.(); // let the hung review finish for a clean exit
});

test("runtime.waitUntilSettled: settles on drain, times out, and aborts", async () => {
	let resolvePrompt;
	const agent = {
		state: { messages: [], model: {} },
		prompt() {
			return new Promise((r) => {
				resolvePrompt = r;
			});
		},
		abort() {},
		reset() {},
	};
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => true), 0);
	rt.push("hang"); // drain starts, prompt hangs → not idle
	assert.equal(await rt.waitUntilSettled(20), "timeout");
	const ac = new AbortController();
	const p = rt.waitUntilSettled(2000, ac.signal);
	ac.abort();
	assert.equal(await p, "aborted");
	resolvePrompt(); // let the drain finish
	assert.equal(await rt.waitUntilSettled(2000), "settled");
});

test("runtime: low-signal pushes stay pending and do not start a review", async () => {
	const reviews = [];
	const agent = {
		state: { messages: [], model: {} },
		async prompt(input) {
			reviews.push(input);
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.push("read 1", { lowSignal: true });
	rt.push("read 2", { lowSignal: true });
	rt.push("read 3", { lowSignal: true });
	assert.equal(reviews.length, 0);
	assert.equal(rt.reviewing, false);
	assert.equal(rt.idle, false);
	assert.equal(await rt.waitUntilSettled(50), "settled", "deferred work is settled for catch-up");
	rt.dispose();
});

test("runtime: a high-signal delta drains the deferred queue", async () => {
	const reviews = [];
	const agent = {
		state: { messages: [], model: {} },
		async prompt(input) {
			reviews.push(typeof input === "string" ? input : input.map((m) => m.content[0].text).join("\n"));
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.push("read 1", { lowSignal: true });
	rt.push("read 2", { lowSignal: true });
	rt.push("edit landed");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(reviews.length, 1);
	assert.match(reviews[0], /read 1/);
	assert.match(reviews[0], /read 2/);
	assert.match(reviews[0], /edit landed/);
	assert.equal(rt.idle, true);
});

test("runtime: held high-priority or terminal forces drain of low-signal pending", async () => {
	const reviews = [];
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			reviews.push("reviewed");
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	const held = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	held.enqueueAdvice("data race", "concern");
	held.push("read", { lowSignal: true });
	assert.equal(await held.waitUntilSettled(2000), "settled");
	assert.equal(reviews.length, 1, "held concern starts drain");

	const terminal = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	terminal.push("read", { lowSignal: true, terminal: true });
	assert.equal(await terminal.waitUntilSettled(2000), "settled");
	assert.equal(reviews.length, 2, "terminal starts drain");
});

test("runtime: backlog and deferral timer drain low-signal pending", async () => {
	const reviews = [];
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			reviews.push("reviewed");
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	const backlog = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	for (let i = 0; i < A.PAIR_DRAIN_BACKLOG; i++) backlog.push(`read ${i}`, { lowSignal: true });
	assert.equal(reviews.length, 0);
	backlog.push("read last", { lowSignal: true });
	assert.equal(await backlog.waitUntilSettled(2000), "settled");
	assert.equal(reviews.length, 1);

	const timed = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	timed.deferMs = 20;
	timed.push("read later", { lowSignal: true });
	assert.equal(reviews.length, 1);
	assert.equal(await timed.waitUntilSettled(20), "settled", "deferral is already settled for catch-up");
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(reviews.length, 2, "deferral timer starts drain");
	timed.dispose();
});

test("runtime: onSettled fires after a review even if more low-signal work is still pending", async () => {
	const settled = [];
	let release;
	const agent = {
		state: { messages: [], model: {} },
		prompt() {
			return new Promise((resolve) => {
				release = () => {
					this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
					resolve();
				};
			});
		},
		abort() {},
		reset() {},
	};
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0, undefined, (outcome) => settled.push(outcome));
	rt.push("edit landed");
	await new Promise((r) => setImmediate(r));
	rt.push("read later", { lowSignal: true });
	release();
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.deepEqual(settled, ["ok"]);
	assert.equal(rt.idle, false);
	assert.equal(rt.reviewing, false);
	rt.dispose();
});

test("runtime.waitUntilSettled: a dropped (3x-failed) review resolves 'failed', held preserved", async () => {
	let attempts = 0;
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			attempts++;
			throw new Error("boom");
		},
		abort() {},
		reset() {},
	};
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.enqueueAdvice("data race", "blocker"); // pre-existing held note
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	assert.equal(attempts, 3, "retried 3x then dropped");
	assert.equal(rt.hasHighPriority, true, "held note preserved across a failed reconfirm");
});

test("runtime.waitUntilSettled: a provider error (stopReason, no throw) resolves 'failed', held preserved", async () => {
	// The real Agent records provider failures as an assistant message with
	// stopReason "error" rather than throwing — that must count as a failed review.
	let attempts = 0;
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			attempts++;
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "error", errorMessage: "503" });
		},
		abort() {},
		reset() {},
	};
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.enqueueAdvice("data race", "blocker");
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	assert.equal(attempts, 3, "errored review retried 3x then dropped");
	assert.equal(rt.hasHighPriority, true, "held note NOT pruned by an errored (non-throwing) review");
});

test("runtime.reprime: stays passive and supplies active context to exactly the next successful review", async () => {
	const reviews = [];
	let resets = 0;
	const agent = {
		state: { messages: [], model: {} },
		async prompt(input) {
			reviews.push(input.map((message) => message.content.map((part) => part.text ?? "").join("\n")).join("\n\n"));
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {
			resets++;
			this.state.messages = [];
		},
	};
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.reprime("PRIOR-ACTIVE-CONTEXT");
	assert.equal(resets, 1, "re-prime resets stale private pair history");
	assert.equal(reviews.length, 0, "re-prime does not review history by itself");
	assert.equal(rt.idle, true);
	assert.equal(rt.backlog, 0);

	rt.push("LATEST-ACTIVITY");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(reviews.length, 1);
	assert.ok(reviews[0].indexOf("PRIOR-ACTIVE-CONTEXT") < reviews[0].indexOf("LATEST-ACTIVITY"));

	rt.push("SECOND-ACTIVITY");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(reviews.length, 2);
	assert.doesNotMatch(reviews[1], /PRIOR-ACTIVE-CONTEXT/, "successful first review consumes the staged context");
});

test("runtime.reprime: an in-flight history rewrite clears the old pair transcript after abort unwinds", async () => {
	let releaseFirst;
	let processing = false;
	let promptCount = 0;
	const reviews = [];
	const agent = {
		state: { messages: [{ role: "assistant", content: [{ type: "text", text: "STALE-PRIVATE-HISTORY" }] }], model: {} },
		async prompt(input) {
			promptCount++;
			if (promptCount === 1) {
				processing = true;
				await new Promise((resolve) => (releaseFirst = resolve));
				this.state.messages.push({
					role: "assistant",
					content: [{ type: "text", text: "ABORTED-OLD-REVIEW" }],
					usage: {},
					stopReason: "aborted",
				});
				processing = false;
				return;
			}
			reviews.push(input.map((message) => message.content.map((part) => part.text ?? "").join("\n")).join("\n\n"));
			assert.deepEqual(this.state.messages, [], "stale and aborted pair messages were cleared before the new review");
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {
			releaseFirst?.();
		},
		reset() {
			if (processing) throw new Error("Agent is already processing");
			this.state.messages = [];
		},
	};
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.push("OLD-REVIEW");
	await new Promise((resolve) => setTimeout(resolve, 0));
	rt.reprime("NEW-ACTIVE-CONTEXT");
	rt.push("NEW-ACTIVITY");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(promptCount, 2);
	assert.match(reviews[0], /NEW-ACTIVE-CONTEXT/);
	assert.match(reviews[0], /NEW-ACTIVITY/);
});

test("runtime.waitUntilSettled: reset() cancels a pending waiter as 'aborted' immediately", async () => {
	let resolvePrompt;
	const agent = {
		state: { messages: [], model: {} },
		prompt() {
			return new Promise((r) => (resolvePrompt = r)); // hang
		},
		abort() {},
		reset() {},
	};
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => true), 0);
	rt.push("hang");
	const p = rt.waitUntilSettled(5000); // would hang on the in-flight prompt
	rt.reset(); // must resolve the waiter now, not wait for the prompt/timeout
	assert.equal(await p, "aborted");
	resolvePrompt?.(); // let the hung prompt unwind for a clean exit
});

test("runtime.waitUntilSettled: a truncated review retries 3 times then fails, without resetting the agent", async () => {
	let attempts = 0;
	let resets = 0;
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			attempts++;
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "length" });
		},
		abort() {},
		reset() {
			resets++;
			this.state.messages = [];
		},
	};
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.enqueueAdvice("data race", "blocker");
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	assert.equal(attempts, 3);
	assert.equal(resets, 0, "overflow is the session compact hook, not a private reset");
	assert.equal(rt.hasHighPriority, true, "held note NOT pruned by a truncated review");
});

test("runtime.waitUntilSettled: a later successful review still prunes recanted holds", async () => {
	let attempts = 0;
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			attempts++;
			this.state.messages.push({
				role: "assistant",
				content: [],
				usage: {},
				stopReason: attempts === 1 ? "length" : "stop",
			});
		},
		abort() {},
		reset() {},
	};
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.enqueueAdvice("data race", "blocker");
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(attempts, 2);
	assert.equal(rt.hasHighPriority, false);
});

test("runtime: a concern/blocker held by a DISCARDED overflowed attempt is rolled back, not kept (finding #1)", async () => {
	// Attempt 1 holds a blocker, then overflows (stopReason length). The reactive
	// self-compaction must roll that hold back: it was raised against a truncated
	// view, and offeredKeys (snapshotted pre-attempt) can't prune it. The fresh
	// replay re-raises only what still applies; here it stays silent, so the
	// phantom blocker must NOT survive (else it'd later deliver as if confirmed).
	let attempts = 0;
	let rt;
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			attempts++;
			if (attempts === 1) {
				rt.enqueueAdvice("phantom blocker from overflowed attempt", "blocker"); // mid-attempt hold
				this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "length" });
			} else {
				this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" }); // silent fresh replay
			}
		},
		abort() {},
		reset() {
			this.state.messages = [];
		},
	};
	rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(attempts, 2, "overflow then a successful fresh replay");
	assert.equal(rt.hasHighPriority, false, "the phantom blocker from the discarded attempt was rolled back");
});

test("runtime: overflow rollback restores pre-existing held severity by value", async () => {
	let attempts = 0;
	let rt;
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			attempts++;
			if (attempts === 1) {
				rt.enqueueAdvice("shared mutation", "blocker"); // escalation in discarded attempt
				this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "length" });
			} else {
				rt.enqueueAdvice("shared mutation", "concern"); // fresh replay confirms original rank only
				this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
			}
		},
		abort() {},
		reset() {
			this.state.messages = [];
		},
	};
	rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.enqueueAdvice("shared mutation", "concern");
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.deepEqual(
		rt.takeAllAdvice(),
		[{ note: "shared mutation", severity: "concern" }],
		"discarded blocker escalation must not mutate rollback snapshot",
	);
});

test("runtime: attempt-only queued advice is rolled back after reactive overflow", async () => {
	let attempts = 0;
	let rt;
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			attempts++;
			if (attempts === 1) {
				rt.enqueueAdvice("phantom nit from truncated review", "nit");
				this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "length" });
			} else {
				this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
			}
		},
		abort() {},
		reset() {
			this.state.messages = [];
		},
	};
	rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.deepEqual(rt.takeAllAdvice(), []);
});

test("runtime: overflow rollback does not resurrect advice concurrently drained at a boundary", async () => {
	let attempts = 0;
	let rt;
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			attempts++;
			if (attempts === 1) {
				assert.deepEqual(rt.takeNits(), [{ note: "already delivered", severity: "nit" }]);
				this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "length" });
			} else {
				this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
			}
		},
		abort() {},
		reset() {
			this.state.messages = [];
		},
	};
	rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.enqueueAdvice("already delivered", "nit");
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.deepEqual(rt.takeAllAdvice(), []);
});

test("runtime: one queue dedupes, escalates, splits nits, and resets", () => {
	const agent = { state: { messages: [], model: {} }, abort() {}, reset() {} };
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.enqueueAdvice("shared mutation", "nit");
	rt.enqueueAdvice("shared   mutation", "blocker");
	rt.enqueueAdvice("small cleanup", "nit");
	assert.deepEqual(rt.takeNits(), [{ note: "small cleanup", severity: "nit" }]);
	assert.deepEqual(rt.takeAllAdvice(), [{ note: "shared mutation", severity: "blocker" }]);
	rt.enqueueAdvice("old transcript", "nit");
	rt.reset();
	assert.deepEqual(rt.takeAllAdvice(), []);
});

test("runtime: the reactive rollback keeps PRE-EXISTING held notes, dropping only the discarded attempt's adds (finding #1)", async () => {
	let attempts = 0;
	let rt;
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			attempts++;
			if (attempts === 1) rt.enqueueAdvice("phantom from overflowed attempt", "blocker"); // only the first attempt adds it
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "length" }); // always overflows ⇒ failed, no prune
		},
		abort() {},
		reset() {
			this.state.messages = [];
		},
	};
	rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.enqueueAdvice("real prior blocker", "blocker"); // pre-existing, captured in the pre-batch snapshot
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	const held = rt.takeAllAdvice();
	assert.equal(held.length, 1, "exactly the pre-existing held note remains");
	assert.equal(held[0].note, "real prior blocker", "phantom dropped by rollback, prior kept");
});

test("runtime: does not privately reset when context is a large fraction of the window", async () => {
	let resets = 0;
	const agent = {
		state: {
			messages: [{ role: "assistant", content: [], usage: { input: 90000, cost: { total: 0.5 } }, stopReason: "stop" }],
			model: { contextWindow: 100000 },
		},
		async prompt() {
			this.state.messages.push({
				role: "assistant",
				content: [],
				usage: { input: 5, cost: { total: 0.01 } },
				stopReason: "stop",
			});
		},
		abort() {},
		reset() {
			resets++;
			this.state.messages = [];
		},
	};
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(resets, 0);
	assert.equal(rt.usage.input, 90005);
});

test("runtime: bound session records each prompt including a self-compaction replay", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pair-usage-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		let attempts = 0;
		const agent = {
			state: { messages: [], model: { provider: "anthropic", id: "claude-opus-5" } },
			async prompt() {
				attempts++;
				this.state.messages.push({
					role: "assistant",
					stopReason: attempts === 1 ? "length" : "stop",
					usage: {
						input: attempts,
						output: 1,
						cacheRead: 2,
						cacheWrite: 0,
						cost: { total: 0.01 * attempts },
					},
				});
			},
			abort() {},
			reset() {
				this.state.messages = [];
			},
		};
		const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
		rt.setUsageSession("session-usage");
		rt.push("secret primary delta");
		assert.equal(await rt.waitUntilSettled(2000), "settled");
		const path = join(agentDir, "sidecar-usage", "session-usage.ndjson");
		const rows = readFileSync(path, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.equal(rows.length, 2);
		assert.equal(rows[0].trigger, "turn_end");
		assert.equal(rows[0].status, "length");
		assert.equal(rows[1].trigger, "turn_end_retry");
		assert.equal(rows[1].status, "stop");
		assert.equal(rows[0].provider, "anthropic");
		assert.equal(rows[0].model, "claude-opus-5");
		assert.equal(JSON.stringify(rows).includes("secret primary delta"), false);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});

test("runtime: unbound session writes no usage records", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pair-usage-unbound-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const agent = {
			state: { messages: [], model: { provider: "anthropic", id: "claude-opus-5" } },
			async prompt() {
				this.state.messages.push({
					role: "assistant",
					stopReason: "stop",
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
				});
			},
			abort() {},
			reset() {},
		};
		const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
		rt.push("turn");
		assert.equal(await rt.waitUntilSettled(2000), "settled");
		assert.equal(existsSync(join(agentDir, "sidecar-usage")), false);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});

test("runtime.acceptingAdvice: an in-flight review orphaned by reset() stops accepting advice", async () => {
	let during;
	let afterReset;
	let rt;
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			during = rt.acceptingAdvice; // reviewEpoch === epoch
			rt.reset(); // bumps epoch → orphans this in-flight review
			afterReset = rt.acceptingAdvice;
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.push("turn");
	await rt.waitUntilSettled(2000);
	assert.equal(during, true, "advice accepted during a live review");
	assert.equal(afterReset, false, "advice rejected once the review's epoch is orphaned");
});

test("runtime queue: re-raising advice at higher severity escalates it", () => {
	const rt = new A.PairRuntime(
		{ state: { messages: [], model: {} }, async prompt() {}, abort() {}, reset() {} },
		new A.AdviseTool(() => false),
		0,
	);
	rt.enqueueAdvice("flaky test", "concern");
	rt.enqueueAdvice("flaky   test", "blocker"); // same note (whitespace-normalized), escalated
	const held = rt.takeAllAdvice();
	assert.equal(held.length, 1, "deduped to one entry");
	assert.equal(held[0].severity, "blocker", "escalation honored");
	// de-escalation is ignored
	rt.enqueueAdvice("x", "blocker");
	rt.enqueueAdvice("x", "concern");
	assert.equal(rt.takeAllAdvice()[0].severity, "blocker");
});

test("boundary: direct Pair and ready Advisor findings share one outbound batch", () => {
	const sent = [];
	const delivered = [];
	const commits = [];
	const direct = [{ note: "Pair finding", severity: "concern", source: "pair" }];
	const advisor = {
		note: { note: "Advisor finding", severity: "blocker", source: "advisor", adjudication: "confirm" },
		commit: (value) => commits.push(value),
	};

	assert.equal(
		A.deliverBoundaryBatch({
			direct,
			advisor,
			send: (notes) => sent.push(notes),
			onDirectDelivered: (note) => delivered.push(note.note),
			onDirectFailed: () => assert.fail("successful send must not requeue"),
		}),
		true,
	);
	assert.equal(sent.length, 1, "one boundary produces one outbound send");
	assert.deepEqual(
		sent[0].map((note) => note.source),
		["pair", "advisor"],
	);
	assert.deepEqual(delivered, ["Pair finding"]);
	assert.deepEqual(commits, [true]);
});

// ===========================================================================
// 2. real loader
// ===========================================================================

async function loadPairExtension() {
	const runtime = createExtensionRuntime();
	const res = await loadExtensions(["index.ts"], SOURCE_DIR, createEventBus(), runtime);
	assert.deepEqual(res.errors, [], "extension should load without errors");
	return res.extensions[0];
}

test("extension loads + registers /pair command, advisory renderer, and branch lifecycle hook", async () => {
	const ext = await loadPairExtension();
	assert.ok(ext.commands.has("pair"), "registers /pair");
	assert.ok(ext.messageRenderers.has("advisory"), "registers advisory renderer");
	assert.ok(ext.handlers.has("session_tree"), "re-primes when the active branch changes");
	assert.ok(ext.handlers.has("before_agent_start"), "injects the primary-agent protocol");
});

test("/pair notebook renders the notebook and keeps no memory alias", async () => {
	const ext = await loadPairExtension();
	const notices = [];
	const ctx = {
		ui: { notify: (text) => notices.push(text) },
		sessionManager: {
			getBranch: () => [
				{
					type: "message",
					id: "source-1",
					message: { role: "user", content: [{ type: "text", text: "Use Notebook terminology." }] },
				},
				{
					type: "custom",
					id: "notebook-entry",
					customType: "notebook.observations.recorded",
					data: {
						observations: [
							{
								id: "aaaaaaaaaaaa",
								content: "User selected Notebook terminology.",
								timestamp: "2026-08-27 19:00",
								relevance: "high",
								sourceEntryIds: ["source-1"],
								tokenCount: 6,
							},
						],
						coversUpToId: "source-1",
					},
				},
			],
		},
	};

	await ext.commands.get("pair").handler("notebook full", ctx);
	assert.match(notices.at(-1), /User selected Notebook terminology/);

	await ext.commands.get("pair").handler("memory", ctx);
	assert.match(notices.at(-1), /usage: \/pair \[on\|off\|status\|notebook \[full\]\]/);
});

test("agent-core ordering: a steer queued during streaming is inserted after that assistant turn_end", async () => {
	const responders = [];
	const streamFn = () => {
		const stream = new EventStream(
			(event) => event.type === "done" || event.type === "error",
			(event) => (event.type === "done" ? event.message : event.error),
		);
		responders.push((text) =>
			stream.push({
				type: "done",
				reason: "stop",
				message: {
					role: "assistant",
					content: [{ type: "text", text }],
					api: "openai-responses",
					provider: "mock",
					model: "mock",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: Date.now(),
				},
			}),
		);
		return stream;
	};
	const agent = new CoreAgent({ streamFn });
	const order = [];
	agent.subscribe((event) => {
		if (event.type === "turn_start" || event.type === "turn_end") order.push(event.type);
		if (event.type === "message_end" && event.message.role === "assistant")
			order.push(`assistant:${event.message.content[0]?.text}`);
		if (event.type === "message_end" && event.message.role === "custom") order.push("custom:advice");
	});
	const waitForResponders = async (count) => {
		while (responders.length < count) await new Promise((resolve) => setTimeout(resolve, 0));
	};

	const run = agent.prompt("work");
	await waitForResponders(1);
	agent.steer({ role: "custom", customType: "advisory", content: "nit", display: true, timestamp: Date.now() });
	responders[0]("final answer");
	await waitForResponders(2);
	responders[1]("revised answer");
	await run;

	const finalMessage = order.indexOf("assistant:final answer");
	const finalTurnEnd = order.indexOf("turn_end", finalMessage);
	const advice = order.indexOf("custom:advice");
	assert.ok(
		finalMessage >= 0 && finalTurnEnd > finalMessage && advice > finalTurnEnd,
		`unexpected order: ${order.join(" → ")}`,
	);
});

// Drive real extension handlers for the hidden no-model command seam. Production
// callbacks use PairRuntime's shared queue (covered by integration tests).
async function lifecycleHarness() {
	const sent = [];
	const runtime = createExtensionRuntime();
	runtime.sendMessage = (msg, opts) => sent.push({ content: msg.content, opts });
	const res = await loadExtensions(["index.ts"], SOURCE_DIR, createEventBus(), runtime);
	assert.deepEqual(res.errors, []);
	const ext = res.extensions[0];
	const h = (name) => {
		const v = ext.handlers.get(name);
		return Array.isArray(v) ? v[0] : v;
	};
	return {
		sent,
		h,
		cmd: ext.commands.get("pair").handler,
		uiCtx: { ui: { notify: () => {} } },
		turnCtx: { model: undefined, cwd: HERE },
	};
}

test("lifecycle: before_agent_start appends the primary protocol only while enabled", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pair-prompt-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const x = await lifecycleHarness();
		const base = "You are the coding agent.";
		const onResult = x.h("before_agent_start")({ prompt: "go", systemPrompt: base }, x.uiCtx);
		assert.deepEqual(onResult, { systemPrompt: A.appendPrimaryPairPrompt(base) });

		await x.cmd("off", x.uiCtx);
		const offResult = x.h("before_agent_start")({ prompt: "go", systemPrompt: base }, x.uiCtx);
		assert.equal(offResult, undefined);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}
});

test("lifecycle: primary compact leaves the pair alone; identity change does not dump primary context", async () => {
	const x = await lifecycleHarness();
	let builds = 0;
	const ctx = {
		sessionManager: {
			buildContextEntries() {
				builds++;
				return [];
			},
		},
		ui: { setStatus: () => {} },
	};
	for (const reason of ["startup", "reload", "new", "resume", "fork"]) {
		x.h("session_start")({ reason }, ctx);
	}
	x.h("session_compact")({}, ctx);
	x.h("session_tree")({}, ctx);
	assert.equal(builds, 0, "pair no longer reprimes from Pi's active context");
	assert.deepEqual(x.sent, [], "identity change never emits advice by itself");
});

test("lifecycle: a direct late nit after terminal turn_end restates", async () => {
	assert.ok(!process.env.PAIR_NO_REVIEW, "needs the real turn_end handler");
	const x = await lifecycleHarness();
	await x.h("turn_end")(
		{ message: { role: "assistant", content: [{ type: "text", text: "final answer" }] } },
		x.turnCtx,
	);
	await x.cmd("test nit parked", x.uiCtx);
	assert.equal(x.sent.length, 1);
	assert.match(x.sent[0].content, /self-contained final answer/);
	assert.match(x.sent[0].content, /context="raised about an earlier step"/);
});

test("lifecycle: a terminal advisory closes review until the next user message", async () => {
	assert.ok(!process.env.PAIR_NO_REVIEW, "needs the real turn_end handler");
	const x = await lifecycleHarness();
	await x.h("turn_end")(
		{ message: { role: "assistant", content: [{ type: "text", text: "final answer" }] } },
		x.turnCtx,
	);
	await x.cmd("test nit first", x.uiCtx);
	assert.equal(x.sent.length, 1);

	await x.h("turn_end")(
		{ message: { role: "assistant", content: [{ type: "text", text: "revised answer" }] } },
		x.turnCtx,
	);
	await x.cmd("test nit suppressed", x.uiCtx);
	assert.equal(x.sent.length, 1, "the advisory-triggered correction must not start another review loop");

	x.h("message_end")({ message: { role: "user", content: [{ type: "text", text: "next request" }] } });
	await x.cmd("test nit next", x.uiCtx);
	assert.equal(x.sent.length, 2, "new user input opens a new supervision episode");
});

test("lifecycle: a direct late nit after non-terminal turn_end does not restate", async () => {
	assert.ok(!process.env.PAIR_NO_REVIEW, "needs the real turn_end handler");
	const x = await lifecycleHarness();
	await x.h("turn_end")(
		{ message: { role: "assistant", content: [{ type: "text", text: "working" }, { type: "toolCall" }] } },
		x.turnCtx,
	);
	await x.cmd("test nit midrun", x.uiCtx);
	assert.equal(x.sent.length, 1);
	assert.doesNotMatch(x.sent[0].content, /self-contained final answer/);
	assert.match(x.sent[0].content, /context="raised about an earlier step"/);
});

// ===========================================================================
// 3. render path
// ===========================================================================

async function renderAdvisory(notes) {
	const ext = await loadPairExtension();
	const renderer = ext.messageRenderers.get("advisory");
	const message = {
		role: "custom",
		customType: "advisory",
		content: [{ type: "text", text: "x" }],
		display: true,
		details: { notes },
		timestamp: Date.now(),
	};
	const comp = new CustomMessageComponent(message, renderer);
	comp.setExpanded(false);
	return strip(comp.render(100).join("\n"));
}

test("render: advisory card shows severity tag + note text", async () => {
	const text = await renderAdvisory([{ note: "this divides by zero on empty input", severity: "blocker" }]);
	assert.match(text, /pair/i);
	assert.match(text, /BLOCKER/);
	assert.match(text, /divides by zero/);
});

test("render: plain nit shows NIT tag", async () => {
	const text = await renderAdvisory([{ note: "tidy this up" }]);
	assert.match(text, /NIT/);
	assert.match(text, /tidy this up/);
});

test("render: advisory card has a left border on both the heading and body lines", async () => {
	const text = await renderAdvisory([{ note: "tidy this up", severity: "concern" }]);
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	assert.ok(lines.length >= 2, `expected a heading + body line, got: ${JSON.stringify(lines)}`);
	for (const line of lines) assert.match(line, /^\u2502 /, `line missing border prefix: ${JSON.stringify(line)}`);
	assert.ok(
		lines.some((line) => /Pair/.test(line) && /CONCERN/.test(line)),
		"heading line carries both the Pair label and severity tag",
	);
});

test("render: multiple advisory notes in one message render as separate bordered cards", async () => {
	const text = await renderAdvisory([
		{ note: "first issue", severity: "nit" },
		{ note: "second issue", severity: "blocker" },
	]);
	assert.match(text, /first issue/);
	assert.match(text, /second issue/);
	assert.match(text, /NIT/);
	assert.match(text, /BLOCKER/);
	// A blank (border-less) line separates the two cards.
	const rows = text.split("\n");
	assert.ok(
		rows.some((line) => line.trim() === ""),
		"expected a spacer row between the two cards",
	);
});

// ===========================================================================
// 4. pi harness (E2E) — nit delivers immediately + triggers a turn
//
// Only the nit path is live-testable: the /pair test hook runs under
// PAIR_NO_REVIEW (no pair model), so high-severity notes have no runtime
// to hold them and no turn_end block to deliver them. The hold → reconfirm →
// catch-up-block → deliver flow is covered deterministically by the offline
// runtime tests above.
// ===========================================================================

class RpcPi {
	constructor() {
		const cwd = mkdtempSync(join(tmpdir(), "pair-e2e-"));
		execSync("git init -q", { cwd });
		writeFileSync(join(cwd, "README.md"), "# test\n");
		this.cwd = cwd;
		this.events = [];
		this.agentStarts = 0;
		this.agentEnds = 0;
		this.proc = spawn(
			PI_BIN,
			["--mode", "rpc", "--model", "anthropic/claude-haiku-4-5", "--session-dir", join(cwd, ".sessions")],
			{ cwd, env: { ...process.env, PAIR_NO_REVIEW: "1" } },
		);
		this.proc.stderr.on("data", () => {});
		let buffer = "";
		const decoder = new StringDecoder("utf8");
		this.proc.stdout.on("data", (chunk) => {
			buffer += decoder.write(chunk);
			for (;;) {
				const i = buffer.indexOf("\n");
				if (i === -1) break;
				let line = buffer.slice(0, i);
				buffer = buffer.slice(i + 1);
				if (line.endsWith("\r")) line = line.slice(0, -1);
				if (!line.trim()) continue;
				let ev;
				try {
					ev = JSON.parse(line);
				} catch {
					continue;
				}
				this.events.push(ev);
				if (ev.type === "agent_start") this.agentStarts++;
				if (ev.type === "agent_end") this.agentEnds++;
			}
		});
	}
	send(cmd) {
		this.proc.stdin.write(`${JSON.stringify(cmd)}\n`);
	}
	prompt(message) {
		this.send({ type: "prompt", message });
	}
	async sleep(ms) {
		return new Promise((r) => setTimeout(r, ms));
	}
	async waitFor(pred, timeoutMs, label) {
		const t0 = Date.now();
		while (Date.now() - t0 < timeoutMs) {
			if (pred()) return true;
			await this.sleep(150);
		}
		throw new Error(`timeout waiting for ${label}`);
	}
	async getMessages() {
		const id = `gm-${Math.random().toString(36).slice(2)}`;
		const before = this.events.length;
		this.send({ id, type: "get_messages" });
		await this.waitFor(
			() => this.events.slice(before).some((e) => e.type === "response" && e.id === id),
			5000,
			"get_messages response",
		);
		const resp = this.events.slice(before).find((e) => e.type === "response" && e.id === id);
		return resp?.data?.messages || [];
	}
	kill() {
		try {
			this.proc.kill("SIGTERM");
		} catch {}
	}
}

if (process.env.PAIR_E2E) {
	test("E2E: a nit is delivered at its turn boundary, triggers a turn, and lands in transcript", async () => {
		const pi = new RpcPi();
		try {
			await pi.sleep(2500);
			const before = pi.agentStarts;
			pi.prompt("/pair test nit NITPAIR tidy this later");
			// nits now steer + triggerTurn: an idle agent wakes to act on them.
			await pi.waitFor(() => pi.agentStarts > before, 30000, "nit-triggered agent_start");
			await pi.waitFor(() => pi.agentEnds >= 1, 60000, "triggered turn agent_end");
			const adv = (await pi.getMessages()).find(
				(m) => m.role === "custom" && m.customType === "advisory" && JSON.stringify(m).includes("NITPAIR"),
			);
			assert.ok(adv, "nit advisory lands in the transcript as an advisory custom message");
		} finally {
			pi.kill();
		}
	});
} else {
	test("E2E (skipped: set PAIR_E2E=1 to run the pi harness)", () => {});
}

// ===========================================================================
// runner
// ===========================================================================

for (const [name, fn] of tests) {
	try {
		await fn();
		passed++;
		console.log(`  ok   ${name}`);
	} catch (err) {
		console.error(`  FAIL ${name}\n       ${err.message}`);
	}
}
console.log(`\n${passed}/${tests.length} passed`);
process.exit(passed === tests.length ? 0 : 1);
