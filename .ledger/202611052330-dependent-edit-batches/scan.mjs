import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

async function scan() {
	let checkout = dirname(fileURLToPath(import.meta.url));
	while (!existsSync(join(checkout, ".git"))) {
		const parent = dirname(checkout);
		if (parent === checkout) throw new Error("Run inside a git checkout");
		checkout = parent;
	}
	const { batchConflicts } = await import(pathToFileURL(join(checkout, "components/repo-rules/src/batches.ts")).href);
	const [rootArg, sessionsDir, start, end] = process.argv.slice(2);
	if (!rootArg || !sessionsDir || !start || !end) throw new Error("Expected root sessionsDir sinceISO untilISO");
	const root = realpathSync(rootArg);
	const since = Date.parse(start);
	const until = Date.parse(end);
	if (!Number.isFinite(since) || !Number.isFinite(until) || until < since) throw new Error("Invalid scan window");
	const seen = new Set();
	const sessions = new Set();
	const records = [];
	const unclassified = [];
	const counts = {
		sessions: 0,
		batches: 0,
		mutationBatches: 0,
		mixedReadOrShell: 0,
		matchedBatches: 0,
		duplicateCopies: 0,
		malformed: 0,
		unavailableWorkingDirectories: 0,
		matcherErrors: 0,
	};
	function files(dir) {
		return readdirSync(dir, { withFileTypes: true })
			.sort((a, b) => a.name.localeCompare(b.name))
			.flatMap((e) =>
				e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".jsonl") ? [join(dir, e.name)] : [],
			);
	}
	function localPath(path) {
		const rel = relative(root, path);
		return rel.startsWith("../") || rel === ".." ? "<outside-repository>" : rel;
	}
	function repositoryHeader(cwd) {
		if (resolve(cwd) === root) return true;
		try {
			return realpathSync(cwd) === root;
		} catch {
			counts.unavailableWorkingDirectories++;
			return false;
		}
	}
	function callsInWindow(entry) {
		const at = Date.parse(entry.timestamp);
		if (
			!Number.isFinite(at) ||
			at < since ||
			at > until ||
			entry.message?.role !== "assistant" ||
			!Array.isArray(entry.message.content)
		)
			return [];
		return entry.message.content.filter(
			(c) => c?.type === "toolCall" && typeof c.id === "string" && typeof c.name === "string",
		);
	}
	for (const file of files(sessionsDir)) {
		if (statSync(file).mtimeMs < since) continue;
		const input = createReadStream(file, "utf8");
		const lines = createInterface({ input, crlfDelay: Infinity });
		let session;
		try {
			for await (const line of lines) {
				let e;
				try {
					e = JSON.parse(line);
				} catch {
					counts.malformed++;
					continue;
				}
				if (!session) {
					if (e.type !== "session" || typeof e.cwd !== "string" || typeof e.id !== "string") break;
					if (!repositoryHeader(e.cwd)) break;
					session = e;
					continue;
				}
				const calls = callsInWindow(e);
				if (!calls.length) continue;
				const key = createHash("sha256")
					.update(JSON.stringify([e.id, e.timestamp, calls]))
					.digest("hex");
				if (seen.has(key)) {
					counts.duplicateCopies++;
					continue;
				}
				seen.add(key);
				sessions.add(session.id);
				counts.sessions = sessions.size;
				counts.batches++;
				const writes = calls.filter((c) => ["edit", "write"].includes(c.name));
				if (!writes.length) continue;
				counts.mutationBatches++;
				if (calls.some((c) => ["read", "bash"].includes(c.name))) counts.mixedReadOrShell++;
				let conflicts;
				try {
					conflicts = batchConflicts(calls, root);
				} catch {
					counts.matcherErrors++;
					unclassified.push({ ref: `entry:${session.id}/${e.id}`, at: e.timestamp, tools: calls.map((c) => c.name) });
					continue;
				}
				if (!conflicts.length) continue;
				counts.matchedBatches++;
				records.push({
					ref: `entry:${session.id}/${e.id}`,
					at: e.timestamp,
					tools: calls.map((c) => c.name),
					paths: [...new Set(conflicts.map((c) => localPath(c.path)))],
					conflicts: conflicts.map((c) => ({
						tool: calls.find((call) => call.id === c.callId).name,
						path: localPath(c.path),
						kind: c.kind,
						alreadyRefused: calls.some(
							(call) =>
								call.id === c.callId &&
								call.name === "bash" &&
								/\bgit\s+(add|commit)\b/.test(String(call.arguments?.command ?? "")),
						),
					})),
				});
			}
		} finally {
			lines.close();
			input.destroy();
		}
	}
	records.sort((a, b) => a.at.localeCompare(b.at) || a.ref.localeCompare(b.ref));
	console.log(
		JSON.stringify(
			{ since: new Date(since).toISOString(), until: new Date(until).toISOString(), counts, records, unclassified },
			null,
			2,
		),
	);
}
await scan().catch(() => {
	console.error("Batch scan failed; source diagnostics suppressed to preserve transcript privacy.");
	process.exitCode = 1;
});
