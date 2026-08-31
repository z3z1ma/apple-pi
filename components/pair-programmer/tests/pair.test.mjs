/**
 * Tests for the /pair extension (a persistent second model that reviews each
 * turn and injects advice). Mirrors review.test.mjs structure.
 *
 * Layers:
 *   1. pure logic        — severity helpers, backoff, terminal detection, arg
 *                          parsing, advisory/​delta formatting, primary-agent
 *                          protocol, AdviseTool dedup (no model/network/TUI)
 *   1b. runtime mechanics — real PairRuntime + stub Agent coverage for
 *                          hold → reconfirm → deliver/drop and settlement
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
const S = await jiti.import(resolve(HERE, "../src/session.ts"));
const P = await jiti.import(resolve(HERE, "../../shared/src/model-profiles.ts"));

// formatTurnDelta returns a markdown string with verbatim (un-escaped) content.
const renderDelta = (o) => A.formatTurnDelta(o);

initTheme();

// Keep loader-level lifecycle tests independent from the operator's real pair programmer
// enablement and prompt state. Individual tests may temporarily override this.
const ORIGINAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;
const TEST_AGENT_DIR = mkdtempSync(join(tmpdir(), "pair-agent-dir-"));
process.env.PI_CODING_AGENT_DIR = TEST_AGENT_DIR;
process.on("exit", () => {
	if (ORIGINAL_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = ORIGINAL_AGENT_DIR;
	rmSync(TEST_AGENT_DIR, { recursive: true, force: true });
});

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ===========================================================================
// 1. pure logic
// ===========================================================================

test("isHighSeverity: only concern/blocker carry priority metadata", () => {
	assert.equal(A.isHighSeverity(undefined), false);
	assert.equal(A.isHighSeverity("nit"), false);
	assert.equal(A.isHighSeverity("concern"), true);
	assert.equal(A.isHighSeverity("blocker"), true);
});

test("isTerminalTurn: only a response without tool calls is terminal", () => {
	assert.equal(A.isTerminalTurn({ content: [{ type: "text" }] }), true);
	assert.equal(A.isTerminalTurn({ content: [] }), true);
	assert.equal(A.isTerminalTurn(undefined), true);
	assert.equal(A.isTerminalTurn({ content: [{ type: "toolCall" }] }), false);
	assert.equal(A.isTerminalTurn({ content: [{ type: "text" }, { type: "toolCall" }] }), false);
});

test("formatPairFooterText: pair programmer is default and consultant work is visible", () => {
	assert.equal(A.formatPairFooterText(false, 0), "Pair programmer: $0.00");
	assert.equal(A.formatPairFooterText(true, 0.02), "Pair programmer (reviewing): $0.02");
	assert.equal(A.formatPairFooterText(false, 1.5), "Pair programmer: $1.50");
	assert.equal(A.formatPairFooterText(false, 0.02, "consultant_running", 0.5), "Pair programmer → Consultant: $0.52");
	assert.equal(
		A.formatPairFooterText(false, 0.02, "escalation_pending", 0.5),
		"Pair programmer (consultant queued): $0.52",
	);
	assert.equal(
		A.formatPairFooterText(false, 0.02, "delivery_pending", 0.5),
		"Pair programmer (consultant ready): $0.52",
	);
});

test("formatReconfirmPreamble: empty when nothing held, else lists held notes", () => {
	assert.equal(A.formatReconfirmPreamble([]), "");
	const p = A.formatReconfirmPreamble([
		{ id: "pair-123456789abc", note: "races on shared map", severity: "blocker" },
		{ id: "pair-abcdef123456", note: "missing await", severity: "nit" },
	]);
	assert.match(p, /Things you flagged earlier/);
	assert.match(p, /call `share_note` again/);
	assert.match(p, /finding_id/);
	assert.match(p, /never merge distinct material issues/);
	assert.match(p, /- \[BLOCKER id=pair-123456789abc\] races on shared map/);
	assert.match(p, /- \[NIT id=pair-abcdef123456\] missing await/);
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

test("formatAdvisoryContent: wraps with finding id, severity + guidance, escapes XML", () => {
	const c = A.formatAdvisoryContent([{ id: "pair-123", note: "use <T> & stuff", severity: "concern" }]);
	assert.match(c, /<pair-note id="pair-123" severity="concern" guidance="pause, consider, then use your judgment">/);
	assert.match(c, /use &lt;T&gt; &amp; stuff/);
	assert.match(c, /<\/pair-note>/);
});

test("material pair programmer findings receive opaque ids that remain stable when carried forward", () => {
	const first = A.identifyMaterialPairNotes([
		{ note: "Inspect the durable boundary.", severity: "concern" },
		{ note: "Tidy the name.", severity: "nit" },
	]);
	const second = A.identifyMaterialPairNotes([{ note: "Inspect the durable boundary.", severity: "blocker" }]);
	const carried = A.identifyMaterialPairNotes([first[0]]);
	assert.match(first[0].id, /^pair-[a-f0-9]{12}$/);
	assert.notEqual(first[0].id, second[0].id);
	assert.equal(carried[0].id, first[0].id);
	assert.equal(first[1].id, undefined);
});

test("PairAcknowledgmentTracker allows one reminder then closes an unacknowledged finding", () => {
	const tracker = new A.PairAcknowledgmentTracker();
	const [finding] = A.identifyMaterialPairNotes([{ note: "Persist before acknowledging.", severity: "blocker" }]);
	tracker.recordDelivered([finding]);
	assert.equal(tracker.pendingCount, 1);
	assert.deepEqual(tracker.terminalActions(), { remind: [], close: [] });

	tracker.advanceTurn();
	const firstTerminal = tracker.terminalActions();
	assert.deepEqual(firstTerminal.close, []);
	assert.deepEqual(
		firstTerminal.remind.map((item) => item.id),
		[finding.id],
	);
	tracker.markReminded([finding.id]);

	tracker.advanceTurn();
	const secondTerminal = tracker.terminalActions();
	assert.deepEqual(secondTerminal.remind, []);
	assert.deepEqual(
		secondTerminal.close.map((item) => item.id),
		[finding.id],
	);
	assert.equal(tracker.resolve(finding.id).id, finding.id);
	assert.equal(tracker.pendingCount, 0);
});

test("PairAcknowledgmentTracker validates a typed reason without mutating pending findings", () => {
	const tracker = new A.PairAcknowledgmentTracker();
	const [finding] = A.identifyMaterialPairNotes([{ note: "Keep the transaction atomic.", severity: "concern" }]);
	tracker.recordDelivered([finding]);
	assert.deepEqual(tracker.validate([{ id: finding.id, disposition: "address", reason: "Use one commit point." }]), []);
	assert.deepEqual(tracker.validate([{ id: finding.id, disposition: "decline", reason: "   " }]), [
		`finding ${finding.id} requires a concise reason`,
	]);
	assert.equal(tracker.pendingCount, 1);
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

test("formatTurnDelta: presents material-finding acknowledgments as feedback to the pair programmer", () => {
	const rendered = A.formatTurnDelta({
		assistant: {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "ack-1",
					name: "acknowledge_pair_findings",
					arguments: {
						findings: [
							{
								id: "pair-abc123",
								disposition: "decline",
								reason: "The current implementation already preserves the turn boundary.",
							},
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
				toolCallId: "ack-1",
				toolName: "acknowledge_pair_findings",
				content: [{ type: "text", text: "Recorded 1 pair programmer finding acknowledgment." }],
				isError: false,
				timestamp: 2,
			},
		],
	});
	assert.match(rendered, /Your partner's feedback on earlier findings/);
	assert.match(rendered, /disposition: decline/);
	assert.match(rendered, /already preserves the turn boundary/);
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

test("formatTurnDelta: empty input stays empty, but a completed empty assistant turn keeps its boundary", () => {
	assert.equal(A.formatTurnDelta({}), "");
	assert.match(
		A.formatTurnDelta({
			assistant: {
				role: "assistant",
				content: [],
				usage: {},
				stopReason: "aborted",
				timestamp: 1,
			},
		}),
		/Assistant turn ended without visible content \(stop reason: aborted\)/,
	);
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

test("runtime: a failed prompt keeps the seed for the next review", async () => {
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
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	rt.push("delta two", { terminal: true });
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(prompts.length, 3, "the later wake retries the retained claim before processing new input");
	assert.match(JSON.stringify(prompts[0]), /ORIENTATION-SEED/);
	assert.match(JSON.stringify(prompts[1]), /ORIENTATION-SEED/);
	assert.doesNotMatch(JSON.stringify(prompts[2]), /ORIENTATION-SEED/);
	rt.dispose();
});

test("pair programmer uses one fixed inference profile", () => {
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
		assert.match(prompt, /Call `ask_consultant` instead/);
		assert.match(prompt, /Consolidate symptoms and consequences that share one root cause/);
		assert.match(prompt, /Never call both tools for the same issue/);
		assert.match(prompt, /there is no finding quota/);
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

test("pair programmer settings inherit Pi's native HTTP idle timeout", () => {
	const root = mkdtempSync(join(tmpdir(), "pair-settings-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({ httpIdleTimeoutMs: 123_456, retry: { provider: { timeoutMs: 234_567 } } }),
	);

	try {
		const settings = S.createPairSettingsManager(cwd, agentDir, false);
		assert.equal(settings.getHttpIdleTimeoutMs(), 123_456);
		assert.deepEqual(settings.getRetrySettings(), { enabled: true, maxRetries: 1, baseDelayMs: 1000 });
		assert.deepEqual(settings.getProviderRetrySettings(), {
			timeoutMs: 234_567,
			maxRetries: 0,
			maxRetryDelayMs: 1000,
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the global pair programmer prompt and trusted project PAIR guidance have separate authority", async () => {
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

test("AdviseTool: rejects model-invented finding ids before deduplication", async () => {
	const calls = [];
	const invented = "pair-deadbeefcafe";
	const tool = new A.AdviseTool(
		(note, severity, findingId) => {
			calls.push({ note, severity, findingId });
			return false;
		},
		() => undefined,
	);
	tool.markDelivered("earlier issue", "concern", invented);
	const result = await tool.execute("new", {
		note: "distinct new issue",
		severity: "concern",
		finding_id: invented,
	});
	assert.deepEqual(calls, [{ note: "distinct new issue", severity: "concern", findingId: undefined }]);
	assert.equal(result.details.finding_id, undefined);
});

test("AdviseTool: markDelivered records dedup at the real delivery point", async () => {
	const calls = [];
	const tool = new A.AdviseTool((note, severity) => {
		calls.push({ note, severity });
		return false; // always held (high-severity path)
	});
	// boundary delivery records a held note only after the send succeeds:
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
// 1b. runtime mechanics (offline, stub agent)
//
// The hold/reconfirm/deliver flow needs the real runtime + a controllable pair programmer,
// which a live E2E cannot make deterministic.
// ===========================================================================

async function settleRuntime(runtime, timeoutMs = 5000, signal) {
	runtime.startDrain();
	return runtime.waitUntilSettled(timeoutMs, signal);
}

// --- real PairRuntime + stub Agent: hold → reconfirm → deliver/drop ---
// onReview(text, {tool, rt, reviewCount}) simulates the pair's reaction per review.
function buildIntegration({ onReview } = {}) {
	const delivered = [];
	let rt;
	let reviewCount = 0;
	// Mirrors the extension's turnState while asynchronous review settles.
	const state = { turn: "ended-nonterminal" };
	const tool = new A.AdviseTool((note, severity, findingId) => {
		if (rt && !rt.acceptingAdvice) return false;
		rt.enqueueAdvice(note, severity, findingId); // production callback only enqueues
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
			tool.markDelivered(n.note, n.severity, n.id);
		}
	};
	const flushConfirmed = () => {
		for (const n of rt.takeConfirmedAdvice()) {
			delivered.push({ ...n, kind: "confirmed", stale: true, finalAnswer: false });
			tool.markDelivered(n.note, n.severity, n.id);
		}
	};
	const onSettled = (outcome) => {
		if (outcome !== "ok") return;
		if (state.turn === "ended-terminal") deliverHeld(rt.takeAllAdvice());
		else if (state.turn === "ended-nonterminal") flushConfirmed();
	};
	rt = new A.PairRuntime(agent, tool, 0, undefined, onSettled);
	const block = (terminal, opts = {}) => {
		state.turn = terminal ? "ended-terminal" : "ended-nonterminal";
		if (!terminal) {
			flushConfirmed();
			return Promise.resolve("skipped");
		}
		return settleRuntime(rt, opts.capMs, opts.signal);
	};
	return { rt, tool, delivered, deliverHeld, block, getReviewCount: () => reviewCount };
}

test("integration: every finding waits for a newer frontier review, then steers during the active run", async () => {
	let findingId;
	const h = buildIntegration({
		onReview: async (text, { tool, reviewCount }) => {
			if (reviewCount === 1) {
				await tool.execute("n1", { note: "rename var", severity: "nit" });
			} else if (reviewCount === 2) {
				findingId = text.match(/id=(pair-[a-f0-9]{12})/)?.[1];
				assert.ok(findingId, "nits receive the same stable reconfirmation identity as every other finding");
				await tool.execute("n2", { note: "rename variable", severity: "nit", finding_id: findingId });
			}
		},
	});
	h.rt.push("turn 1");
	assert.equal(await h.block(false), "skipped", "non-terminal turns never block");
	await h.rt.waitUntilSettled(5000);
	assert.equal(h.delivered.length, 0, "a first observation is held even when it is a nit");

	h.rt.push("turn 2");
	assert.equal(await h.block(false), "skipped");
	await h.rt.waitUntilSettled(5000);
	assert.deepEqual(h.delivered, [
		{
			id: findingId,
			note: "rename variable",
			severity: "nit",
			kind: "confirmed",
			stale: true,
			finalAnswer: false,
		},
	]);
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
	const outcome = await settleRuntime(rt);
	if (outcome === "settled") {
		delivered.push({ notes: rt.takeAllAdvice().map(({ id: _id, ...note }) => note), opts: { terminal: true } });
	}
	assert.deepEqual(delivered, [{ notes: [{ note: "queued race", severity: "nit" }], opts: { terminal: true } }]);
});

test("integration: settlement observation timeout does not fake reconfirmation when late review recants", async () => {
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
	await settleRuntime(rt, 5);
	assert.deepEqual(delivered, [], "timeout does not deliver an unconfirmed nit");
	release();
	await rt.waitUntilSettled(2000);
	assert.deepEqual(delivered, [], "silent late review drops the nit instead of delivering it");
});

test("integration: settlement observation timeout preserves a nit the late review re-raises", async () => {
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
	await settleRuntime(rt, 5);
	assert.deepEqual(delivered, []);
	release();
	await rt.waitUntilSettled(2000);
	assert.deepEqual(
		delivered.map(({ id: _id, ...note }) => note),
		[{ note: "still valid", severity: "nit" }],
	);
});

test("integration: terminal turn — a nit from the lagging previous-turn review is held, reconfirmed by the final turn's review, then delivered", async () => {
	const h = buildIntegration({
		onReview: async (text, { tool, reviewCount }) => {
			if (reviewCount === 1) {
				// review of turn 1, emitted while the terminal turn 2 is already queued
				await tool.execute("n1", { note: "rename var", severity: "nit" });
			} else if (reviewCount === 2) {
				assert.match(text, /Things you flagged earlier/, "the held nit rides the final turn's reconfirm preamble");
				assert.match(text, /\[NIT id=pair-[a-f0-9]{12}\] rename var/);
				await tool.execute("n2", { note: "rename var", severity: "nit" }); // still applies
			}
		},
	});
	// Review 1 lags: turn 2's delta is queued before review 1's async prompt runs.
	h.rt.push("turn 1");
	h.rt.push("final turn");
	assert.equal(await h.block(true), "settled");
	assert.equal(h.getReviewCount(), 2);
	assert.deepEqual(
		h.delivered.map(({ id: _id, ...note }) => note),
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
	assert.equal(await h.block(true), "settled");
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
	assert.equal(await h.block(true), "settled");
	assert.equal(h.getReviewCount(), 1, "no extra reconfirm review — the nit skips the prune and waits for settle");
	assert.deepEqual(
		h.delivered.map(({ id: _id, ...note }) => note),
		[{ note: "rename var", severity: "nit", kind: "held" }],
	);
	assert.equal(h.rt.hasHighPriority, false);
});

test("integration: a failed reconfirm preserves held advice for a later successful review", async () => {
	const h = buildIntegration({
		onReview: async (_text, { tool, reviewCount }) => {
			if (reviewCount === 1) {
				await tool.execute("a1", { note: "off-by-one", severity: "blocker" });
			} else if (reviewCount === 2) {
				await tool.execute("a2", { note: "off-by-one", severity: "nit" });
				throw new Error("provider blip");
			} else if (reviewCount >= 3) {
				await tool.execute(`a${reviewCount}`, { note: "off-by-one", severity: "nit" });
			}
		},
	});
	h.rt.push("turn 1");
	await h.rt.waitUntilSettled(5000);
	assert.equal(h.rt.hasHighPriority, true);
	h.rt.push("turn 2");
	assert.equal(await h.rt.waitUntilSettled(5000), "failed");
	assert.equal(h.delivered.length, 0);
	assert.equal(h.rt.hasHighPriority, true);
	h.rt.push("turn 3", { terminal: true });
	assert.equal(await h.block(true), "settled");
	assert.equal(h.getReviewCount(), 4, "the later wake retries the failed claim before reviewing new input");
	assert.equal(h.delivered.length, 1);
	assert.equal(h.delivered[0].severity, "blocker");
});

test("integration: blocker held on turn 1 survives terminal reconfirmation and delivery", async () => {
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
	assert.equal(await h.block(false), "skipped");
	await h.rt.waitUntilSettled(5000);
	assert.equal(h.rt.hasHighPriority, true);
	assert.equal(h.delivered.length, 0, "nothing delivered on the flagging turn");
	// turn 2: terminal → block until settled; review 2 reconfirms; survivor delivered
	h.rt.push("turn 2");
	assert.equal(await h.block(true), "settled");
	assert.equal(h.getReviewCount(), 2);
	assert.equal(h.delivered.length, 1);
	assert.equal(h.delivered[0].kind, "held");
	assert.equal(h.delivered[0].severity, "blocker");
});

test("integration: a material finding keeps its opaque id across a paraphrased reconfirmation", async () => {
	let findingId;
	const h = buildIntegration({
		onReview: async (text, { tool, reviewCount }) => {
			if (reviewCount === 1) {
				await tool.execute("a1", { note: "durable insert happens after acknowledgment", severity: "blocker" });
			} else if (reviewCount === 2) {
				findingId = text.match(/id=(pair-[a-f0-9]{12})/)?.[1];
				assert.ok(findingId, "the reconfirmation preamble supplies the host identity");
				await tool.execute("a2", {
					note: "acknowledgment precedes the durable insert",
					severity: "blocker",
					finding_id: findingId,
				});
			}
		},
	});
	h.rt.push("turn 1");
	await h.block(false);
	await h.rt.waitUntilSettled(5000);
	h.rt.push("turn 2");
	assert.equal(await h.block(true), "settled");
	assert.equal(h.delivered.length, 1);
	assert.equal(h.delivered[0].id, findingId);
	assert.equal(h.delivered[0].note, "acknowledgment precedes the durable insert");
});

test("integration: a blocker first raised ON the terminal turn is caught + delivered (Q1)", async () => {
	// The pair flags for the first time while the terminal turn is blocked; the
	// The agent did no follow-up (it's stopping), so it's delivered without a reconfirm.
	const h = buildIntegration({
		onReview: async (_text, { tool, reviewCount }) => {
			if (reviewCount === 1) await tool.execute("a1", { note: "leaks an fd", severity: "blocker" });
		},
	});
	h.rt.push("final turn");
	assert.equal(await h.block(true), "settled", "terminal block waits for the review that raises the blocker");
	assert.equal(h.getReviewCount(), 1);
	assert.equal(h.delivered.length, 1, "blocker raised on the terminal turn lands before idle");
	assert.equal(h.delivered[0].kind, "held");
	assert.equal(h.delivered[0].severity, "blocker");
	assert.equal(h.rt.hasHighPriority, false);
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
	assert.equal(await h.block(true), "settled");
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
	assert.equal(await h.block(true), "settled");
	assert.equal(h.delivered.length, 0, "recanted blocker is dropped, not delivered");
	assert.equal(h.rt.hasHighPriority, false);
});

test("integration: a held finding is released after nonterminal frontier reconfirmation", async () => {
	const h = buildIntegration({
		onReview: async (text, { tool, reviewCount }) => {
			if (reviewCount === 1) await tool.execute("a1", { note: "races on cache", severity: "blocker" });
			else if (reviewCount === 2) {
				assert.match(text, /Things you flagged earlier/);
				await tool.execute("a2", { note: "races on cache", severity: "blocker" });
			}
		},
	});
	h.rt.push("turn 1");
	await h.rt.waitUntilSettled(5000);
	assert.equal(h.rt.hasHighPriority, true);
	h.rt.push("turn 2");
	assert.equal(h.rt.hasHighPriority, true, "held note survives push() (no mid-flight splice)");
	assert.equal(await h.block(false), "skipped");
	assert.equal(h.delivered.length, 0, "nonterminal progress does not wait for the review");
	assert.equal(await h.rt.waitUntilSettled(5000), "settled");
	assert.equal(h.rt.hasHighPriority, false);
	assert.equal(h.delivered.length, 1, "the reconfirmed finding is released during the active run");
	assert.equal(h.delivered[0].kind, "confirmed");
	assert.equal(h.delivered[0].severity, "blocker");
});

test("integration: settlement observation timeout leaves a held note unconfirmed", async () => {
	let releaseReview2;
	const h = buildIntegration({
		onReview: async (_text, { tool, reviewCount }) => {
			if (reviewCount === 1) await tool.execute("a1", { note: "fd leak", severity: "blocker" });
			else if (reviewCount === 2) await new Promise((resolve) => (releaseReview2 = resolve));
		},
	});
	h.rt.push("turn 1");
	await h.rt.waitUntilSettled(5000);
	assert.equal(h.rt.hasHighPriority, true);
	h.rt.push("turn 2");
	assert.equal(await h.block(true, { capMs: 30 }), "timeout");
	assert.equal(h.delivered.length, 0, "terminal latency expiry does not promote unconfirmed advice");
	assert.equal(h.rt.hasHighPriority, true);
	releaseReview2?.();
	await h.rt.waitUntilSettled(5000);
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

test("runtime: every appended chunk wakes the idle reader", async () => {
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
	rt.push("read 1");
	await new Promise((r) => setImmediate(r));
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(reviews.length, 1);
	assert.equal(rt.idle, true);
});
test("runtime: arrivals while the reader is busy form its next contiguous batch", async () => {
	let release;
	const reviews = [];
	const agent = {
		state: { messages: [], model: {} },
		prompt(input) {
			reviews.push(input);
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
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.push("one");
	await new Promise((r) => setImmediate(r));
	rt.push("two");
	rt.push("three");
	release();
	await new Promise((r) => setImmediate(r));
	release();
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(reviews.length, 2);
	assert.match(JSON.stringify(reviews[1]), /two/);
	assert.match(JSON.stringify(reviews[1]), /three/);
});

test("runtime: backlog includes in-flight and commits only after every batch", async () => {
	let release;
	const settled = [];
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
	rt.push("one");
	await new Promise((r) => setImmediate(r));
	rt.push("two");
	assert.equal(rt.backlog, 2);
	release();
	await new Promise((r) => setImmediate(r));
	release();
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(rt.backlog, 0);
	assert.deepEqual(settled, ["ok"]);
});

test("runtime: a failed contiguous claim is retained and cannot be skipped", async () => {
	let attempt = 0;
	const prompts = [];
	const agent = {
		state: { messages: [], model: {} },
		async prompt(input) {
			attempt++;
			prompts.push(JSON.stringify(input));
			if (attempt === 1) throw new Error("provider unavailable");
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	const spool = new A.PairSpool();
	const rt = new A.PairRuntime(
		agent,
		new A.AdviseTool(() => false),
		0,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		spool,
	);
	spool.append("boundary one", { boundary: 1 });
	rt.wake();
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	assert.equal(spool.backlog, 1);
	assert.equal(rt.reviewedThrough, 0);

	spool.append("boundary two", { boundary: 2 });
	rt.wake();
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(prompts.length, 3);
	assert.match(prompts[1], /boundary one/);
	assert.doesNotMatch(prompts[1], /boundary two/);
	assert.match(prompts[2], /boundary two/);
	assert.equal(spool.backlog, 0);
	assert.equal(rt.reviewedThrough, 2);
});

test("runtime.waitUntilSettled: a failed review resolves 'failed' once, held preserved", async () => {
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
	assert.equal(attempts, 1, "PairRuntime does not multiply AgentSession retries");
	assert.equal(rt.hasHighPriority, true, "held note preserved across a failed reconfirm");
});

test("runtime.waitUntilSettled: a provider error resolves 'failed' once, held preserved", async () => {
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
	assert.equal(attempts, 1, "provider-error result is not retried by PairRuntime");
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

test("runtime.waitUntilSettled: a truncated review fails once without resetting the agent", async () => {
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
	assert.equal(attempts, 1);
	assert.equal(resets, 0, "overflow is handled by AgentSession, not a PairRuntime retry/reset");
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
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	assert.equal(rt.hasHighPriority, true, "failed review keeps the pre-existing hold");
	rt.push("next turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(attempts, 3);
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
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	assert.equal(rt.hasHighPriority, false, "the discarded attempt committed no phantom blocker");
	rt.push("next turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(attempts, 3, "the later wake retries the retained claim, then reviews the new delta");
	assert.equal(rt.hasHighPriority, false);
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
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	assert.deepEqual(
		rt.takeAllAdvice().map(({ id: _id, ...note }) => note),
		[{ note: "shared mutation", severity: "concern" }],
	);
	rt.enqueueAdvice("shared mutation", "concern");
	rt.push("next turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.deepEqual(
		rt.takeAllAdvice().map(({ id: _id, ...note }) => note),
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
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	assert.deepEqual(rt.takeAllAdvice(), []);
	rt.push("next turn");
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
				assert.deepEqual(rt.takeConfirmedAdvice(), []);
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
	rt.requeueReadyAdvice("already delivered", "nit");
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	assert.deepEqual(rt.takeAllAdvice(), []);
	rt.push("next turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.deepEqual(rt.takeAllAdvice(), []);
});

test("runtime: a stale ready snapshot cannot resurrect a concurrently delivered finding", async () => {
	const findingId = "pair-123456789abc";
	let rt;
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			assert.deepEqual(rt.takeConfirmedAdvice(), [{ id: findingId, note: "already confirmed", severity: "concern" }]);
			rt.enqueueAdvice("already confirmed", "concern", findingId);
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.requeueReadyAdvice("already confirmed", "concern", findingId);
	rt.push("next turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.deepEqual(rt.takeConfirmedAdvice(), []);
	assert.deepEqual(rt.takeAllAdvice(), []);
});

test("runtime: a concurrent genuine escalation remains ready after the lower-severity finding was delivered", async () => {
	const findingId = "pair-123456789abc";
	let rt;
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			assert.equal(rt.takeConfirmedAdvice()[0]?.severity, "concern");
			rt.enqueueAdvice("risk is now proven", "blocker", findingId);
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.requeueReadyAdvice("possible risk", "concern", findingId);
	rt.push("next turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.deepEqual(rt.takeConfirmedAdvice(), [{ id: findingId, note: "risk is now proven", severity: "blocker" }]);
});

test("runtime: the pending queue dedupes and escalates every severity", () => {
	const agent = { state: { messages: [], model: {} }, abort() {}, reset() {} };
	const rt = new A.PairRuntime(agent, new A.AdviseTool(() => false), 0);
	rt.enqueueAdvice("shared mutation", "nit");
	rt.enqueueAdvice("shared   mutation", "blocker");
	rt.enqueueAdvice("small cleanup", "nit");
	assert.deepEqual(rt.takeConfirmedAdvice(), []);
	assert.deepEqual(
		rt.takeAllAdvice().map(({ id: _id, ...note }) => note),
		[
			{ note: "shared mutation", severity: "blocker" },
			{ note: "small cleanup", severity: "nit" },
		],
	);
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

test("runtime: bound session records one failed logical prompt without an outer retry", async () => {
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
		assert.equal(await rt.waitUntilSettled(2000), "failed");
		const path = join(agentDir, "sidecar-usage", "session-usage.ndjson");
		const rows = readFileSync(path, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.equal(rows.length, 1);
		assert.equal(rows[0].trigger, "turn_end");
		assert.equal(rows[0].status, "length");
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

test("runtime: failed reviews commit no direct, consultant, or notebook effects", async () => {
	let attempt = 0;
	let rt;
	const escalations = [];
	const notebookCommits = [];
	let stagedNotebook;
	const notebookTool = {
		begin() {
			stagedNotebook = { batchId: `batch-${attempt + 1}` };
		},
		clear() {
			stagedNotebook = undefined;
		},
		takeStaged() {
			const update = stagedNotebook;
			stagedNotebook = undefined;
			return update;
		},
	};
	const request = {
		severity: "concern",
		claim: "deep queue ownership risk",
		whyDeepReasoning: "ownership spans several layers",
		evidence: [{ kind: "file", ref: "src/queue.ts" }],
	};
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			attempt++;
			rt.enqueueAdvice("direct retry risk", "concern");
			assert.equal(rt.stageEscalation(request), "accepted");
			if (attempt === 1) throw new Error("provider failed after tools ran");
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	rt = new A.PairRuntime(
		agent,
		new A.AdviseTool(() => false),
		0,
		undefined,
		undefined,
		undefined,
		undefined,
		notebookTool,
		(update) => notebookCommits.push(update),
		(requestValue) => {
			escalations.push(requestValue);
			return "accepted";
		},
	);
	rt.push("first turn");
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	assert.deepEqual(rt.takeAllAdvice(), []);
	assert.deepEqual(escalations, []);
	assert.deepEqual(notebookCommits, []);

	rt.push("second turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.deepEqual(
		rt.takeAllAdvice().map(({ id: _id, ...note }) => note),
		[{ note: "direct retry risk", severity: "concern" }],
	);
	assert.equal(escalations.length, 2);
	assert.equal(notebookCommits.length, 2);
});

test("runtime: notebook persistence failure publishes no direct or consultant effects", async () => {
	let rt;
	const escalations = [];
	const notebookTool = {
		begin() {},
		clear() {},
		takeStaged: () => ({ batchId: "batch-1" }),
	};
	const request = {
		severity: "concern",
		claim: "deep queue ownership risk",
		whyDeepReasoning: "ownership spans several layers",
		evidence: [{ kind: "file", ref: "src/queue.ts" }],
	};
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			rt.enqueueAdvice("direct retry risk", "concern");
			rt.stageEscalation(request);
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	rt = new A.PairRuntime(
		agent,
		new A.AdviseTool(() => false),
		0,
		undefined,
		undefined,
		undefined,
		undefined,
		notebookTool,
		() => {
			throw new Error("session append failed");
		},
		(requestValue) => {
			escalations.push(requestValue);
			return "accepted";
		},
	);
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "failed");
	assert.deepEqual(rt.takeAllAdvice(), []);
	assert.deepEqual(escalations, []);
});

test("runtime: one successful attempt collapses an exact direct/consultant shared root", async () => {
	let rt;
	const escalations = [];
	const request = {
		severity: "concern",
		claim: "shared queue ownership",
		whyDeepReasoning: "ownership spans several layers",
		evidence: [{ kind: "file", ref: "src/queue.ts" }],
	};
	const agent = {
		state: { messages: [], model: {} },
		async prompt() {
			rt.enqueueAdvice("shared queue ownership", "concern");
			rt.stageEscalation(request);
			this.state.messages.push({ role: "assistant", content: [], usage: {}, stopReason: "stop" });
		},
		abort() {},
		reset() {},
	};
	rt = new A.PairRuntime(
		agent,
		new A.AdviseTool(() => false),
		0,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		(requestValue) => {
			escalations.push(requestValue);
			return "accepted";
		},
	);
	rt.push("turn");
	assert.equal(await rt.waitUntilSettled(2000), "settled");
	assert.equal(escalations.length, 1);
	assert.deepEqual(rt.takeAllAdvice(), [], "the same root is not queued on both delivery paths");
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

test("boundary: a send failure requeues direct findings and retains consultant delivery", () => {
	const delivered = [];
	const failed = [];
	const advisorCommits = [];
	assert.throws(
		() =>
			A.deliverBoundaryBatch({
				direct: [{ note: "retry this", severity: "concern" }],
				advisor: {
					note: { note: "validated finding", severity: "concern", source: "consultant" },
					commit: (...args) => advisorCommits.push(args),
				},
				send: () => {
					throw new Error("session closed");
				},
				onDirectDelivered: (note) => delivered.push(note),
				onDirectFailed: (note) => failed.push(note),
			}),
		/session closed/,
	);
	assert.deepEqual(delivered, []);
	assert.deepEqual(failed, [{ note: "retry this", severity: "concern" }]);
	assert.deepEqual(advisorCommits, [], "a transient send failure leaves the validated consultant candidate pending");
});

test("boundary: an exact cross-source duplicate keeps the direct finding only", () => {
	const sent = [];
	const commits = [];
	const direct = [{ note: "Shared queue ownership", severity: "concern", source: "pair" }];
	const advisor = {
		note: { note: "consultant restatement", severity: "concern", source: "consultant" },
		dedupeKeys: ["shared queue ownership"],
		commit: (...args) => commits.push(args),
	};
	assert.equal(
		A.deliverBoundaryBatch({
			direct,
			advisor,
			send: (notes) => sent.push(notes),
			onDirectDelivered: () => {},
			onDirectFailed: () => {},
		}),
		true,
	);
	assert.deepEqual(sent, [direct]);
	assert.deepEqual(commits, [[false, true]], "duplicate consultant identity remains suppressed without a second send");
});

test("boundary: direct pair programmer and ready consultant findings share one outbound batch", () => {
	const sent = [];
	const delivered = [];
	const commits = [];
	const direct = [{ note: "pair programmer finding", severity: "concern", source: "pair" }];
	const advisor = {
		note: { note: "consultant finding", severity: "blocker", source: "consultant", adjudication: "confirm" },
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
		["pair", "consultant"],
	);
	assert.deepEqual(delivered, ["pair programmer finding"]);
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
	assert.match(notices.at(-1), /Usage: \/pair \[on\|off\|status\|notebook \[full\]\]/);
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
	const appended = [];
	const runtime = createExtensionRuntime();
	runtime.sendMessage = (msg, opts) => sent.push({ ...msg, opts });
	runtime.appendEntry = (customType, data) => appended.push({ customType, data });
	const res = await loadExtensions(["index.ts"], SOURCE_DIR, createEventBus(), runtime);
	assert.deepEqual(res.errors, []);
	const ext = res.extensions[0];
	const h = (name) => {
		const v = ext.handlers.get(name);
		return Array.isArray(v) ? v[0] : v;
	};
	const emit = async (name, ...args) => {
		const value = ext.handlers.get(name);
		for (const handler of Array.isArray(value) ? value : [value]) await handler?.(...args);
	};
	return {
		sent,
		appended,
		h,
		emit,
		ack: ext.tools.get("acknowledge_pair_findings").definition,
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

test("lifecycle: terminal turn_end returns synchronously while pair programmer construction is pending", async () => {
	const root = mkdtempSync(join(tmpdir(), "pair-detached-"));
	const agentDir = join(root, "agent");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "model-profiles.json"),
		JSON.stringify({ profiles: { pair: { model: "test-provider/test-model", thinking: "low" } } }),
	);
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		const x = await lifecycleHarness();
		const model = { provider: "test-provider", id: "test-model", contextWindow: 100_000 };
		let authStarted = false;
		const ctx = {
			cwd: root,
			modelRegistry: {
				find: (provider, id) => (provider === model.provider && id === model.id ? model : undefined),
				getApiKeyAndHeaders: () => {
					authStarted = true;
					return new Promise(() => {});
				},
			},
			sessionManager: { getBranch: () => [] },
			isProjectTrusted: () => false,
			ui: { setStatus: () => {} },
		};
		const result = x.h("turn_end")(
			{ message: { role: "assistant", content: [{ type: "text", text: "final answer" }] }, toolResults: [] },
			ctx,
		);
		assert.equal(result, undefined, "the primary hook must not return pair programmer's pending work");
		assert.equal(authStarted, true, "pair programmer construction still starts in the background");
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(root, { recursive: true, force: true });
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

async function withPairReviewDisabled(run) {
	const previous = process.env.PAIR_NO_REVIEW;
	process.env.PAIR_NO_REVIEW = "1";
	try {
		await run();
	} finally {
		if (previous === undefined) delete process.env.PAIR_NO_REVIEW;
		else process.env.PAIR_NO_REVIEW = previous;
	}
}

test("lifecycle: a pair programmer nit steers the active run at the next assistant-turn boundary", async () => {
	await withPairReviewDisabled(async () => {
		const x = await lifecycleHarness();
		x.h("before_agent_start")({ prompt: "go", systemPrompt: "base" }, x.uiCtx);
		x.h("agent_start")();
		x.h("turn_start")();
		await x.cmd("test nit Stop before compounding this mistake.", x.uiCtx);
		assert.equal(x.sent.length, 0, "streaming work is not interrupted mid-turn");

		x.h("turn_end")(
			{
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "README.md" } }],
				},
				toolResults: [],
			},
			x.turnCtx,
		);

		assert.equal(x.sent.length, 1, "the note must steer before the overall agent run settles");
		assert.equal(x.sent[0].opts.deliverAs, "steer");
		assert.equal(x.sent[0].opts.triggerTurn, true);
		assert.match(x.sent[0].content, /Stop before compounding this mistake/);
	});
});

test("lifecycle: an aborted turn can receive advice without autonomously restarting", async () => {
	await withPairReviewDisabled(async () => {
		const x = await lifecycleHarness();
		x.h("before_agent_start")({ prompt: "go", systemPrompt: "base" }, x.uiCtx);
		x.h("turn_start")();
		await x.cmd("test nit Preserve this note after abort.", x.uiCtx);

		x.h("turn_end")(
			{
				message: {
					role: "assistant",
					content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "README.md" } }],
				},
				toolResults: [],
			},
			{ ...x.turnCtx, signal: AbortSignal.abort() },
		);

		assert.equal(x.sent.length, 1);
		assert.equal(x.sent[0].opts.deliverAs, "steer");
		assert.equal(x.sent[0].opts.triggerTurn, false);
	});
});

test("lifecycle: a typed material-finding acknowledgment is persisted and prevents a reminder", async () => {
	await withPairReviewDisabled(async () => {
		const x = await lifecycleHarness();
		const [finding] = A.identifyMaterialPairNotes([
			{ note: "Persist before acknowledging.", severity: "concern", source: "pair" },
		]);
		const ctx = {
			cwd: HERE,
			sessionManager: {
				getBranch: () => [{ type: "custom_message", customType: "advisory", details: { notes: [finding] } }],
			},
			ui: { setStatus: () => {} },
		};
		x.h("session_start")({}, ctx);

		const result = await x.ack.execute("ack-1", {
			findings: [{ id: finding.id, disposition: "address", reason: "Move the acknowledgment after commit." }],
		});
		assert.deepEqual(result.details, { accepted: [finding.id], errors: [] });
		assert.deepEqual(x.appended, [
			{
				customType: "pair.finding.acknowledged",
				data: {
					id: finding.id,
					note: "Persist before acknowledging.",
					severity: "concern",
					source: "pair",
					deliveredTurn: 0,
					disposition: "address",
					reason: "Move the acknowledgment after commit.",
				},
			},
		]);

		await x.h("turn_end")({ message: { role: "assistant", content: [{ type: "text", text: "revised answer" }] } }, ctx);
		assert.equal(x.sent.length, 0, "an acknowledged finding must not produce a reminder");
	});
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
		lines.some((line) => /pair programmer/.test(line) && /CONCERN/.test(line)),
		"heading line carries both the pair programmer label and severity tag",
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
// 4. pi harness (E2E) — a synthetic ready finding triggers a turn
//
// The /pair test hook runs under PAIR_NO_REVIEW and injects a ready finding, so
// this covers Pi delivery rather than the pair model's confirmation cycle. The
// hold → reconfirm → active-run delivery flow is covered deterministically by
// the offline runtime tests above.
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
