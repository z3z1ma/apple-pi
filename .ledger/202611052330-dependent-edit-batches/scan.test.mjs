import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const bundle = dirname(fileURLToPath(import.meta.url));
let checkout = bundle;
while (!existsSync(join(checkout, ".git"))) {
	const parent = dirname(checkout);
	if (parent === checkout) throw new Error("Run inside a git checkout");
	checkout = parent;
}
const register = join(checkout, "components/session-state/src/register.mjs");
const since = "2026-11-04T16:01:52Z";
const until = "2026-11-06T06:28:36Z";
function fixture(run) {
	const dir = mkdtempSync(join(tmpdir(), "batch-scan-test-"));
	const root = join(dir, "repo");
	const logs = join(dir, "logs");
	mkdirSync(root);
	mkdirSync(logs);
	const header = (cwd = root) => ({ type: "session", id: "synthetic-session", cwd });
	const entry = (id, path = "app.ts") => ({
		type: "message",
		id,
		timestamp: "2026-11-05T01:00:00Z",
		message: {
			role: "assistant",
			content: [
				{ type: "toolCall", id: `${id}-w`, name: "write", arguments: { path, content: "synthetic" } },
				{ type: "toolCall", id: `${id}-r`, name: "read", arguments: { path: "app.ts" } },
			],
		},
	});
	const log = (name, entries) =>
		writeFileSync(join(logs, name), `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
	const scan = (selectedRoot = root) =>
		spawnSync(process.execPath, ["--import", register, join(bundle, "scan.mjs"), selectedRoot, logs, since, until], {
			encoding: "utf8",
			timeout: 30_000,
		});
	try {
		return run({ root, logs, header, entry, log, scan });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("invalid transcript arguments never escape through stdout or stderr", () =>
	fixture(({ header, entry, log, scan }) => {
		log("a.jsonl", [header(), entry("bad", "file://DO_NOT_RETAIN_SENTINEL%"), entry("good")]);
		const result = scan();
		assert.equal(result.status, 0);
		assert.equal((result.stdout + result.stderr).includes("DO_NOT_RETAIN_SENTINEL"), false);
		assert.equal(JSON.parse(result.stdout).counts.matchedBatches, 1);
	}));

test("a removed unrelated cwd is safely excluded without discarding valid records", () =>
	fixture(({ root, header, entry, log, scan }) => {
		log("a.jsonl", [header(), entry("good")]);
		log("b.jsonl", [header(join(root, "REMOVED_SENTINEL")), entry("outside")]);
		const result = scan();
		assert.equal(result.status, 0);
		assert.equal(result.stderr, "");
		assert.equal(result.stdout.includes("REMOVED_SENTINEL"), false);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.counts.matchedBatches, 1);
		assert.equal(parsed.counts.unavailableWorkingDirectories, 1);
	}));

test("partially overlapping snapshots count distinct sessions, not contributing files", () =>
	fixture(({ header, entry, log, scan }) => {
		log("a.jsonl", [header(), entry("one")]);
		log("b.jsonl", [header(), entry("one"), entry("two")]);
		const result = scan();
		assert.equal(result.status, 0);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.counts.sessions, 1);
		assert.equal(parsed.counts.batches, 2);
		assert.equal(parsed.counts.duplicateCopies, 1);
	}));

test("fatal scan diagnostics use a fixed message rather than source-derived exception fields", () =>
	fixture(({ root, scan }) => {
		const result = scan(join(root, "PRIVATE_ROOT_SENTINEL"));
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr.includes("PRIVATE_ROOT_SENTINEL"), false);
		assert.match(result.stderr, /source diagnostics suppressed/);
	}));
