import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	copyFileSync,
	createReadStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { eligibleProjection, historicalPrefix, sha256, sourceIdentity } from "./engine-replay.mjs";
import { sourceAddress, taskCorpus } from "./task-control.mjs";

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const environmentKeys = ["PI_CODING_AGENT_DIR", "PI_SESSION_STATE_DISABLED", "TMUX_TMPDIR", "TMUX", "TMUX_PANE"];

export function replayCorpus(question) {
	if (question.corpus) return taskCorpus(question);
	const historical = historicalPrefix(question);
	const source = { session_id: historical.prefix.find((entry) => entry.type === "session")?.id, eligible_spans: [] };
	if (!source.session_id) throw new Error("Prefix has no session identity");
	return [
		{
			...historical,
			source,
			active: new Set(historical.branch.map((entry) => entry.id)),
			eligible: new Set(eligibleProjection(historical.prefix, historical.branch, question).map((entry) => entry.id)),
		},
	];
}

async function startScratch(root, corpus, caller, sourceRoot, background) {
	const previous = environmentKeys.map((key) => [key, process.env[key]]);
	const state = join(root, "state");
	mkdirSync(state);
	process.env.PI_CODING_AGENT_DIR = root;
	process.env.PI_SESSION_STATE_DISABLED = "";
	process.env.TMUX_TMPDIR = join(root, "tmux");
	process.env.TMUX = "";
	process.env.TMUX_PANE = "";
	let child;
	let log;
	const stop = async () => {
		try {
			if (child && child.exitCode === null && child.signalCode === null) {
				await new Promise((done) => {
					child.once("exit", done);
					child.kill("SIGTERM");
				});
			}
		} finally {
			if (log !== undefined) closeSync(log);
			for (const [key, value] of previous) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	};
	try {
		const { migrate } = await import(pathToFileURL(join(sourceRoot, "components/session-state/src/schema.ts")));
		const { openIndex, indexTranscript } = await import(
			pathToFileURL(join(sourceRoot, "components/session-state/src/transcript-index.ts"))
		);
		const db = new DatabaseSync(join(state, "apple-pi.db"));
		try {
			migrate(db);
			const person = db.prepare(
				"insert into sessions(id,name,kind,cwd,run_state,generation,source,updated_at,session_file,reports_to) values (?,?,'root',?,'idle',1,'test',0,?,?)",
			);
			const message = db.prepare(
				"insert into messages(session_id,entry_id,part,at,role,size,preview,source) values (?,?,'',?,'user',1,'','test')",
			);
			const span = db.prepare(
				"insert into focus_spans(person,task_id,started_at,ended_at,reconstructed) values (?,?,?,?,1)",
			);
			db.exec("begin");
			for (const c of corpus) {
				person.run(
					c.source.session_id,
					c.source.person_name ?? c.source.session_id,
					root,
					c.file,
					c.source.session_id === caller ? null : caller,
				);
				for (const entry of c.prefix) {
					const at = Date.parse(entry.timestamp);
					if (entry.id && Number.isFinite(at)) message.run(c.source.session_id, entry.id, at);
				}
				for (const s of c.source.eligible_spans)
					span.run(c.source.session_id, s.task_id, Date.parse(s.from_at), Date.parse(s.to_at));
			}
			db.exec("commit");
		} finally {
			db.close();
		}
		const indexPath = join(state, "transcript-index.db");
		let backgroundCopyMs = 0;
		if (background) {
			const frozen = new DatabaseSync(background, { readOnly: true });
			try {
				const version = frozen.prepare("pragma user_version").get().user_version;
				const columns = frozen
					.prepare("pragma table_info(entries)")
					.all()
					.map((row) => row.name);
				if (version !== 2 || !columns.includes("ordinal") || !columns.includes("echo"))
					throw new Error("Background must already have v2 ordinal/echo columns; migration would erase it");
			} finally {
				frozen.close();
			}
			const copyStarted = performance.now();
			copyFileSync(background, indexPath);
			backgroundCopyMs = performance.now() - copyStarted;
		}
		const index = openIndex(indexPath);
		const started = performance.now();
		let indexedRows;
		try {
			for (const c of corpus) {
				index.prepare("delete from entries where session_id = ?").run(c.source.session_id);
				index.prepare("delete from files where session_id = ?").run(c.source.session_id);
				await indexTranscript(index, c.source.session_id, c.file);
			}
			indexedRows = index.prepare("select count(*) as n from entries").get().n;
		} finally {
			index.close();
		}
		const buildMs = performance.now() - started;
		const indexBytes = [indexPath, `${indexPath}-wal`, `${indexPath}-shm`]
			.filter(existsSync)
			.reduce((sum, file) => sum + statSync(file).size, 0);
		log = openSync(join(root, "runtime.log"), "w", 0o600);
		child = spawn(
			process.execPath,
			[
				"--import",
				join(sourceRoot, "components/session-state/src/register.mjs"),
				join(sourceRoot, "components/session-state/src/runtime-main.ts"),
			],
			{ env: process.env, stdio: ["ignore", log, log] },
		);
		const deadline = performance.now() + 10000;
		while (!existsSync(join(state, "apple-pi.sock"))) {
			if (child.exitCode !== null || performance.now() > deadline)
				throw new Error("Scratch runtime did not start; inspect private runtime log");
			await pause(20);
		}
		return { stop, buildMs, indexBytes, indexedRows, backgroundCopyMs };
	} catch (error) {
		await stop();
		throw error;
	}
}

export async function actualReplay({ goldPath, output, sourceRoot, repeats = 0, background }) {
	const goldBytes = readFileSync(goldPath);
	const gold = JSON.parse(goldBytes);
	const identity = {
		search: sourceIdentity(sourceRoot, "components/session-search/src"),
		runtime: sourceIdentity(sourceRoot, "components/session-state/src"),
	};
	const { sessionSearchTool } = await import(pathToFileURL(join(sourceRoot, "components/session-search/src/tool.ts")));
	let backgroundIdentity = null;
	if (background) {
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(background)) hash.update(chunk);
		backgroundIdentity = { sha256: hash.digest("hex"), bytes: statSync(background).size };
	}
	const results = [];
	for (const question of gold.questions) {
		const corpus = replayCorpus(question);
		const root = mkdtempSync("/tmp/kofi-tool-replay-");
		let runtime;
		try {
			for (const [n, c] of corpus.entries()) {
				c.file = join(root, `${n}.jsonl`);
				writeFileSync(c.file, c.text, { mode: 0o600 });
			}
			const callerId = question.session_id ?? corpus[0].source.session_id;
			const caller = corpus.find((c) => c.source.session_id === callerId);
			if (!caller) throw new Error("Caller missing from frozen corpus");
			const setupStarted = performance.now();
			runtime = await startScratch(root, corpus, callerId, sourceRoot, background);
			const runtimeSetupMs = performance.now() - setupStarted;
			const branch = caller.prefix.filter((entry) => caller.active.has(entry.id));
			const params = {
				...question.params,
				...(question.corpus ? { tasks: question.retrieval.tasks } : {}),
				fields: "all",
			};
			const context = {
				sessionManager: {
					getSessionId: () => callerId,
					getSessionFile: () => caller.file,
					getEntries: () => caller.prefix,
					getBranch: () => branch,
				},
			};
			const invoke = () =>
				sessionSearchTool.execute(
					question.tool_call_id ?? "research-authored-handoff",
					params,
					undefined,
					undefined,
					context,
				);
			const started = performance.now();
			const response = await invoke();
			const firstMs = performance.now() - started;
			const warmMs = [];
			for (let n = 0; n < repeats; n++) {
				const warmStart = performance.now();
				const again = await invoke();
				warmMs.push(performance.now() - warmStart);
				if (JSON.stringify(again) !== JSON.stringify(response)) throw new Error("Warm output changed");
			}
			const sources = response.details?.sources ?? response.details?.hits ?? [];
			const violations = [];
			for (const hit of sources) {
				const c = corpus.find((item) => item.source.session_id === (hit.session ?? callerId));
				const entry = c?.prefix.find((item) => item.id === hit.entryId);
				if (!entry) violations.push("unknown-source");
				else {
					if (!c.eligible.has(entry.id)) violations.push("outside-control-eligibility");
					const ordinal =
						entry.type === "message"
							? c.prefix.slice(0, c.prefix.indexOf(entry)).filter((item) => item.type === "message").length
							: undefined;
					if ((hit.index ?? undefined) !== ordinal) violations.push("ordinal-mismatch");
				}
			}
			results.push({
				id: question.id,
				ids: sources.map((hit) => hit.entryId),
				addresses: sources.map((hit) => sourceAddress(hit.session ?? callerId, hit.entryId)),
				params,
				text: response.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n"),
				details: response.details,
				toolError: !!response.isError,
				violations,
				actualToolDisplay: true,
				firstMs,
				warmMs,
				buildMs: runtime.buildMs,
				runtimeSetupMs,
				backgroundCopyMs: runtime.backgroundCopyMs,
				indexBytes: runtime.indexBytes,
				indexedRows: runtime.indexedRows,
				prefixes: corpus.map((c) => ({
					session: c.source.session_id,
					sha256: sha256(c.text),
					bytes: Buffer.byteLength(c.text),
				})),
				authorization: question.corpus
					? "synthetic reporting grant for declared corpus; historical authorization unknown"
					: "own-session",
			});
			writeFileSync(
				output,
				JSON.stringify(
					{
						goldSha256: sha256(goldBytes),
						identity,
						harnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
						background: backgroundIdentity,
						results,
					},
					null,
					2,
				),
				{ mode: 0o600 },
			);
			for (const c of corpus)
				if (sha256(readFileSync(c.file)) !== sha256(c.text)) throw new Error("Scratch prefix mutated");
		} catch (error) {
			writeFileSync(
				`${output}.error.json`,
				JSON.stringify({
					id: question.id,
					error: String(error),
					runtimeLog: existsSync(join(root, "runtime.log")) ? readFileSync(join(root, "runtime.log"), "utf8") : null,
				}),
				{ mode: 0o600 },
			);
			throw error;
		} finally {
			if (runtime) await runtime.stop();
			rmSync(root, { recursive: true, force: true });
		}
	}
	if (
		JSON.stringify(identity.search) !== JSON.stringify(sourceIdentity(sourceRoot, "components/session-search/src")) ||
		JSON.stringify(identity.runtime) !== JSON.stringify(sourceIdentity(sourceRoot, "components/session-state/src"))
	)
		throw new Error("Frozen tool source changed");
	return {
		questions: results.length,
		returned: results.reduce((sum, row) => sum + row.ids.length, 0),
		violations: results.reduce((sum, row) => sum + row.violations.length, 0),
		revision: identity.search.revision,
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.umask(0o077);
	const [goldPath, output, sourceRoot, count = "0", background] = process.argv.slice(2);
	if (!goldPath || !output || !sourceRoot || !resolve(output).startsWith("/tmp/"))
		throw new Error("Pass PRIVATE_GOLD /tmp/PRIVATE_OUTPUT FROZEN_TOOL_ROOT [REPEATS] [PRIVATE_BACKGROUND]");
	console.log(JSON.stringify(await actualReplay({ goldPath, output, sourceRoot, repeats: Number(count), background })));
}
