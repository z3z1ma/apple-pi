/** Exercise setup-failure cleanup with isolated settings; no model request is reached. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const base = mkdtempSync(join(tmpdir(), "selection-cleanup-check-"));
try {
	const home = join(base, "home");
	const temporary = join(base, "tmp");
	mkdirSync(home);
	mkdirSync(temporary);
	const run = spawnSync(process.execPath, [fileURLToPath(new URL("selection-check.mjs", import.meta.url))], {
		env: { ...process.env, HOME: home, TMPDIR: temporary, PI_CODING_AGENT_DIR: join(home, ".pi/agent") },
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.equal(run.status, 1, run.stderr);
	assert.match(run.stderr, /ENOENT/);
	assert.match(run.stderr, /settings\.json/);
	const leaked = readdirSync(temporary).filter((name) => name.startsWith("process-selection-"));
	assert.deepEqual(leaked, []);
	console.log(
		JSON.stringify({
			failure: "missing isolated settings before model runtime construction",
			leakedScratchDirectories: leaked.length,
		}),
	);
} finally {
	rmSync(base, { recursive: true, force: true });
}
