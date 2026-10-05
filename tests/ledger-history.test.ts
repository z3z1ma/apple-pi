import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireExclusiveLease } from "../components/shared/src/exclusive-lease.js";
import installLedger from "../extensions/ledger.js";

const roots: string[] = [];

function temporaryRoot(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-ledger-history-")));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
	return execFileSync(
		"git",
		["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
		{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();
}

function repository(path: string): string {
	mkdirSync(path, { recursive: true });
	git(path, "init", "-q");
	return commit(path);
}

function commit(path: string): string {
	git(path, "commit", "-q", "--allow-empty", "-m", "change");
	return git(path, "rev-parse", "HEAD");
}

function ledger() {
	const tools = new Map<string, any>();
	const handlers = new Map<string, (event: any, ctx: any) => unknown>();
	installLedger({
		on: (event: string, handler: (event: any, ctx: any) => unknown) => handlers.set(event, handler),
		registerTool: (tool: any) => tools.set(tool.name, tool),
	} as any);
	// A string is a persisted session with that ID; an in-memory SessionManager has no session file.
	const ctx = (cwd: string, session: Session, trusted = true, signal?: AbortSignal) => ({
		cwd,
		signal,
		isProjectTrusted: () => trusted,
		sessionManager:
			typeof session === "string"
				? { getSessionId: () => session, getSessionFile: () => `/sessions/${session}.jsonl` }
				: session,
	});
	return {
		async add(cwd: string, sessionId: Session): Promise<string> {
			const result = await tools
				.get("ledger_add")
				.execute(
					"call",
					{ title: "Capture", description: "Record history" },
					undefined,
					undefined,
					ctx(cwd, sessionId),
				);
			return result.details.taskId;
		},
		async status(cwd: string, sessionId: Session, task: string, status: string) {
			await tools.get("ledger_status").execute("call", { task, status }, undefined, undefined, ctx(cwd, sessionId));
		},
		async changed(cwd: string, sessionId: Session, toolName: "write" | "edit", path: string, signal?: AbortSignal) {
			await handlers.get("tool_result")?.(
				{ type: "tool_result", toolCallId: "call", toolName, input: { path }, content: [], isError: false },
				// Untrusted, like a Pi Exec worker: edits still link.
				ctx(cwd, sessionId, false, signal),
			);
		},
		/** A bash or pi_exec call whose execution runs `change`. */
		async ran(cwd: string, sessionId: Session, toolName: "bash" | "pi_exec", change: () => void) {
			const context = ctx(cwd, sessionId, false);
			await handlers.get("tool_call")?.({ type: "tool_call", toolCallId: "call", toolName, input: {} }, context);
			change();
			await handlers.get("tool_result")?.(
				{ type: "tool_result", toolCallId: "call", toolName, input: {}, content: [], isError: false },
				context,
			);
		},
	};
}

type Session = string | SessionManager;

function ids(path: string): string[] {
	return history(path)
		.sessions.map((session: { id: string }) => session.id)
		.sort();
}

function holdLease(root: string): () => void {
	return acquireExclusiveLease("ledger-transactions", root, randomUUID(), { owned: () => "busy", failed: "failed" });
}

function history(path: string) {
	return JSON.parse(readFileSync(join(path, "history.json"), "utf8"));
}

describe("ledger history capture", () => {
	it("records the session and the start and close commits, and keeps them in the archive", async () => {
		const root = temporaryRoot();
		repository(root);
		const pi = ledger();
		const taskId = await pi.add(root, "session-1");
		const start = commit(root);
		await pi.status(root, "session-1", taskId, "in-progress");
		const close = commit(root);
		await pi.status(root, "session-1", taskId, "done");

		const recorded = history(join(root, ".ledger/history", taskId));
		expect(recorded.sessions).toEqual([{ id: "session-1", linkedAt: expect.any(String), via: "ledger_add" }]);
		expect(recorded.commits).toEqual([
			{ event: "in-progress", at: expect.any(String), repository: ".", commit: start },
			{ event: "done", at: expect.any(String), repository: ".", commit: close },
		]);
	});

	it("links a session that changes a bundle file once, and ignores one that does not", async () => {
		const root = temporaryRoot();
		const pi = ledger();
		const taskId = await pi.add(root, "session-1");
		const bundle = join(root, ".ledger", taskId);
		writeFileSync(join(bundle, "notes.md"), "notes\n");
		writeFileSync(join(root, "README.md"), "readme\n");

		await pi.changed(root, "session-2", "write", `.ledger/${taskId}/notes.md`);
		await pi.changed(root, "session-2", "edit", join(bundle, "task.md"));
		await pi.changed(root, "session-3", "write", "README.md");
		await pi.changed(root, "session-3", "edit", ".ledger/INDEX.md");
		await pi.status(root, "session-2", taskId, "ready");
		await pi.status(root, "session-1", taskId, "cancelled");

		expect(history(join(root, ".ledger/history", taskId)).sessions).toEqual([
			{ id: "session-1", linkedAt: expect.any(String), via: "ledger_add" },
			{ id: "session-2", linkedAt: expect.any(String), via: "edit" },
		]);
	});

	it("records each repository below a parent-directory ledger", async () => {
		const root = temporaryRoot();
		const first = repository(join(root, "repo-a"));
		const second = repository(join(root, "repo-b"));
		mkdirSync(join(root, "plain"));
		const pi = ledger();
		const taskId = await pi.add(root, "session-1");
		await pi.status(root, "session-1", taskId, "in-progress");

		expect(history(join(root, ".ledger", taskId)).commits).toEqual([
			{ event: "in-progress", at: expect.any(String), repository: "repo-a", commit: first },
			{ event: "in-progress", at: expect.any(String), repository: "repo-b", commit: second },
		]);
	});

	it("names the enclosing repository relative to a ledger root nested inside it", async () => {
		const top = temporaryRoot();
		const head = repository(top);
		const root = join(top, "service");
		mkdirSync(root);
		const pi = ledger();
		const taskId = await pi.add(root, "session-1");
		await pi.status(root, "session-1", taskId, "in-progress");

		expect(history(join(root, ".ledger", taskId)).commits).toEqual([
			{ event: "in-progress", at: expect.any(String), repository: "..", commit: head },
		]);
	});

	it("links a session outside git without recording commits", async () => {
		const root = temporaryRoot();
		const pi = ledger();
		const taskId = await pi.add(root, "session-1");
		await pi.status(root, "session-1", taskId, "in-progress");
		await pi.status(root, "session-1", taskId, "done");

		expect(history(join(root, ".ledger/history", taskId))).toEqual({
			sessions: [{ id: "session-1", linkedAt: expect.any(String), via: "ledger_add" }],
			commits: [],
		});
	});

	it("waits for a busy ledger and keeps concurrent links", async () => {
		const root = temporaryRoot();
		const pi = ledger();
		const taskId = await pi.add(root, "session-1");
		const release = acquireExclusiveLease("ledger-transactions", root, randomUUID(), {
			owned: () => "busy",
			failed: "failed",
		});
		const links = Promise.all([
			pi.changed(root, "session-2", "write", `.ledger/${taskId}/task.md`),
			pi.changed(root, "session-3", "edit", `.ledger/${taskId}/retrospective.md`),
		]);
		await new Promise((resolve) => setTimeout(resolve, 100));
		release();
		await links;

		expect(
			history(join(root, ".ledger", taskId))
				.sessions.map((session: { id: string }) => session.id)
				.sort(),
		).toEqual(["session-1", "session-2", "session-3"]);
	});

	it("keeps waiting for a busy ledger past any fixed limit", async () => {
		const root = temporaryRoot();
		const pi = ledger();
		const taskId = await pi.add(root, "session-1");
		const release = holdLease(root);
		vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
		try {
			const link = pi.changed(root, "session-2", "write", `.ledger/${taskId}/task.md`);
			await vi.advanceTimersByTimeAsync(60_000);
			release();
			await vi.advanceTimersByTimeAsync(1_000);
			await link;
		} finally {
			release();
			vi.useRealTimers();
		}

		expect(ids(join(root, ".ledger", taskId))).toEqual(["session-1", "session-2"]);
	});

	it("stops waiting for a busy ledger when the session aborts", async () => {
		const root = temporaryRoot();
		const pi = ledger();
		const taskId = await pi.add(root, "session-1");
		const release = holdLease(root);
		const controller = new AbortController();
		try {
			const link = pi.changed(root, "session-2", "write", `.ledger/${taskId}/task.md`, controller.signal);
			controller.abort();
			await expect(link).resolves.toBeUndefined();
		} finally {
			release();
		}

		expect(ids(join(root, ".ledger", taskId))).toEqual(["session-1"]);
	});

	it("writes a link queued behind a close into the archived bundle", async () => {
		const root = temporaryRoot();
		const pi = ledger();
		const taskId = await pi.add(root, "session-1");
		const release = holdLease(root);
		const link = pi.changed(root, "session-2", "write", `.ledger/${taskId}/task.md`);
		release();
		// The close takes the lease synchronously, before the waiting link retries.
		await Promise.all([pi.status(root, "session-1", taskId, "done"), link]);

		expect(ids(join(root, ".ledger/history", taskId))).toEqual(["session-1", "session-2"]);
	});

	it("resolves tilde, file URL, and @-prefixed paths as Pi's write and edit tools do", async () => {
		const root = temporaryRoot();
		const pi = ledger();
		const taskId = await pi.add(root, "session-1");
		const home = process.env.HOME;
		process.env.HOME = root;
		try {
			await pi.changed(root, "session-2", "edit", `~/.ledger/${taskId}/task.md`);
		} finally {
			process.env.HOME = home;
		}
		const url = pathToFileURL(join(root, ".ledger", taskId, "retrospective.md")).href;
		await pi.changed(root, "session-3", "write", url);
		await pi.changed(root, "session-4", "edit", `@.ledger/${taskId}/task.md`);

		expect(ids(join(root, ".ledger", taskId))).toEqual(["session-1", "session-2", "session-3", "session-4"]);
	});

	it("links sessions whose bash or composed pi_exec calls change a live bundle", async () => {
		const root = temporaryRoot();
		const pi = ledger();
		const taskId = await pi.add(root, "session-1");
		const bundle = join(root, ".ledger", taskId);
		await pi.ran(root, "session-2", "bash", () => writeFileSync(join(bundle, "notes.md"), "notes\n"));
		await pi.ran(root, "session-3", "pi_exec", () => writeFileSync(join(bundle, "task.md"), "changed\n"));
		await pi.ran(root, "session-4", "bash", () => writeFileSync(join(root, "README.md"), "readme\n"));
		await pi.ran(root, "session-4", "pi_exec", () => {});
		// A change that keeps an older modification time, as `cp -p` or `tar x` would.
		await pi.ran(root, "session-5", "bash", () => {
			const retrospective = join(bundle, "retrospective.md");
			const { mtime } = statSync(retrospective);
			writeFileSync(retrospective, "restored\n");
			utimesSync(retrospective, mtime, new Date(mtime.getTime() - 60_000));
		});

		expect(ids(bundle)).toEqual(["session-1", "session-2", "session-3", "session-5"]);
	});

	it("links nothing for a session without a session file", async () => {
		const root = temporaryRoot();
		const head = repository(root);
		const memory = SessionManager.inMemory(root);
		const pi = ledger();
		const taskId = await pi.add(root, memory);
		const bundle = join(root, ".ledger", taskId);
		await pi.changed(root, memory, "edit", `.ledger/${taskId}/task.md`);
		await pi.ran(root, memory, "bash", () => writeFileSync(join(bundle, "notes.md"), "notes\n"));
		await pi.status(root, memory, taskId, "in-progress");

		expect(history(bundle)).toEqual({
			sessions: [],
			commits: [{ event: "in-progress", at: expect.any(String), repository: ".", commit: head }],
		});
	});

	it("links an edit to a parent-directory ledger from a session in a repository below it", async () => {
		const root = temporaryRoot();
		const repo = join(root, "repo-a");
		repository(repo);
		const pi = ledger();
		const taskId = await pi.add(root, "session-1");
		const bundle = join(root, ".ledger", taskId);
		writeFileSync(join(bundle, "notes.md"), "notes\n");
		await pi.changed(repo, "session-2", "write", `../.ledger/${taskId}/notes.md`);

		expect(ids(bundle)).toEqual(["session-1", "session-2"]);
	});
});
