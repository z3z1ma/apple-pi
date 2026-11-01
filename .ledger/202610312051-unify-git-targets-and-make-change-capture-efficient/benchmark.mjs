// Measures shared Git change selection against equivalent native Git commands.
// Run from the repository root: node --import ./components/session-state/src/register.mjs <this file> [repetitions]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, ".ledger"))) root = dirname(root);
const { captureReview, verifyArtifact } = await import(join(root, "components/code-review/src/capture.ts"));
const { openGitChange, GIT_DIFF } = await import(join(root, "components/shared/src/git-change.ts"));
const { readChange } = await import(join(root, "components/browser-pages/src/git-diff.ts"));

const repetitions = Number(process.argv[2] ?? 3);
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 30 });
const time = async (run) => {
	const samples = [];
	for (let i = 0; i < repetitions; i++) {
		const start = performance.now();
		await run(i);
		samples.push(performance.now() - start);
	}
	samples.sort((a, b) => a - b);
	return Math.round(samples[Math.floor(samples.length / 2)]);
};
const native = (cwd, args) => time(() => git(cwd, ...args));

async function synthetic(name, setup) {
	const cwd = await mkdtemp(join(tmpdir(), `git-bench-${name}-`));
	git(cwd, "init", "-q", "-b", "main");
	git(cwd, "config", "user.email", "bench@example.invalid");
	git(cwd, "config", "user.name", "Bench");
	await setup(cwd);
	return cwd;
}
async function files(cwd, count, text, prefix = "src") {
	for (let i = 0; i < count; i++) {
		const path = join(cwd, prefix, `d${i % 50}`, `f${i}.ts`);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, text(i));
	}
}

const scratch = await mkdtemp(join(tmpdir(), "git-bench-out-"));
const cases = [
	{ name: "this checkout", cwd: root },
	{
		name: "20k files, 2k modified",
		cwd: await synthetic("wide", async (cwd) => {
			await files(cwd, 20000, (i) => `export const v${i} = ${i};\n`);
			git(cwd, "add", ".");
			git(cwd, "commit", "-qm", "base");
			await files(cwd, 2000, (i) => `export const v${i} = ${i + 1};\n`);
		}),
	},
	{
		name: "5k untracked files",
		cwd: await synthetic("untracked", async (cwd) => {
			await files(cwd, 1000, (i) => `${i}\n`);
			git(cwd, "add", ".");
			git(cwd, "commit", "-qm", "base");
			await files(cwd, 5000, (i) => `${i}\n`, "new");
		}),
	},
];
const linked = join(scratch, "linked");
git(cases[1].cwd, "worktree", "add", "-q", linked, "HEAD");
await writeFile(join(linked, "src/d0/f0.ts"), "linked edit\n");
cases.push({ name: "linked worktree", cwd: linked });

const results = [];
try {
	for (const { name, cwd } of cases) {
		const target = { kind: "working-tree", base: "HEAD" };
		const row = { case: name };
		row["native git status"] = await native(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
		row["native git diff HEAD"] = await native(cwd, ["diff", "--no-ext-diff", "HEAD"]);
		row["open working tree"] = await time(async () => (await openGitChange(cwd, target)).close());
		row["open + patch"] = await time(async () => {
			const change = await openGitChange(cwd, target);
			await change.git([...GIT_DIFF, "-U3", change.baseTree, change.headTree]);
			await change.close();
		});
		row["page diff (sign-off/explain)"] = await time(async () => (await readChange(cwd, target)).close());
		row["open commit"] = await time(async () => (await openGitChange(cwd, { kind: "commit", commit: "HEAD" })).close());
		row["review capture"] = await time(async (i) => {
			await captureReview({ cwd, target }, join(scratch, `${results.length}-${i}`), AbortSignal.timeout(300_000));
		});
		const artifact = await captureReview({ cwd, target }, join(scratch, `${results.length}-verify`));
		row["verify (median; the first run re-hashes racy files)"] = await time(() => verifyArtifact(artifact));
		results.push(row);
		console.log(JSON.stringify(row));
	}
} finally {
	await rm(scratch, { recursive: true, force: true });
	for (const { cwd } of cases.slice(1, 3)) await rm(cwd, { recursive: true, force: true });
}
console.log(JSON.stringify({ repetitions, results }, null, 2));
