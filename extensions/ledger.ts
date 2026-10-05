import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { acquireExclusiveLease } from "../components/shared/src/exclusive-lease.js";
import { LEDGER_SYSTEM_PROMPT, LEDGER_SYSTEM_PROMPT_TAG } from "../components/shared/src/ledger-system-prompt.js";
import { setSystemPromptSection } from "../components/shared/src/system-prompt-section.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TASK_ID = /^\d{12}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LIVE_STATUSES = ["planning", "ready", "in-progress"] as const;
const CLOSED_STATUSES = ["done", "cancelled"] as const;
const STATUSES = [...LIVE_STATUSES, ...CLOSED_STATUSES] as const;
const LIVE_INDEX = ".ledger/INDEX.md";
const HISTORY_INDEX = ".ledger/history/INDEX.md";
const LEDGER_LEASE_KIND = "ledger-transactions";
const LEDGER_LEASE_BUSY = "A ledger transaction is busy";
const LEDGER_LEASE_FAILED = "Unable to acquire the ledger transaction lease";
const HISTORY_FILE = "history.json";
const OPAQUE_CHANGE_TOOLS = new Set(["bash", "pi_exec"]);

export const LEDGER_EXTENSION_PATH = fileURLToPath(import.meta.url);

export type LiveLedgerStatus = (typeof LIVE_STATUSES)[number];
export type ClosedLedgerStatus = (typeof CLOSED_STATUSES)[number];
export type LedgerStatus = (typeof STATUSES)[number];

export interface AddedLedgerTask {
	taskId: string;
	bundlePath: string;
	taskPath: string;
	indexPath: string;
}

/** Pointers to a task's work; measures are derived later from the linked transcripts. */
interface LedgerHistory {
	sessions: { id: string; linkedAt: string; via: "ledger_add" | "ledger_status" | "edit" }[];
	commits: { event: "in-progress" | ClosedLedgerStatus; at: string; repository: string; commit: string }[];
}

interface HistoryUpdate {
	sessionId?: string;
	via: LedgerHistory["sessions"][number]["via"];
	event?: LedgerHistory["commits"][number]["event"];
	heads?: { repository: string; commit: string }[];
}

export interface TransitionedLedgerTask {
	taskId: string;
	status: LedgerStatus;
	bundlePath: string;
	taskPath: string;
	indexPath: string;
}

function two(value: number): string {
	return String(value).padStart(2, "0");
}

function localStamp(now: Date): { stamp: string; date: string } {
	const year = now.getFullYear();
	const month = two(now.getMonth() + 1);
	const day = two(now.getDate());
	const hour = two(now.getHours());
	const minute = two(now.getMinutes());
	return { stamp: `${year}${month}${day}${hour}${minute}`, date: `${year}-${month}-${day}` };
}

function normalizedLine(value: string, label: string, max: number): string {
	const line = value.trim().replace(/\s+/g, " ");
	if (!line || line.length > max || /[\r\n]/.test(value)) {
		throw new Error(`${label} must be one line between 1 and ${max} characters`);
	}
	return line;
}

function slugFrom(title: string, requested?: string): string {
	const slug = (requested?.trim() || title)
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80)
		.replace(/-+$/g, "");
	if (!SLUG.test(slug)) throw new Error("slug must contain lowercase letters, numbers, and single hyphens only");
	return slug;
}

function lstatIfPresent(path: string) {
	try {
		return lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function pathExists(path: string): boolean {
	return lstatIfPresent(path) !== undefined;
}

function assertDirectory(path: string, label: string): void {
	const stat = lstatIfPresent(path);
	if (!stat) return;
	if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a non-symlink directory`);
}

function assertRegularFile(path: string, label: string): void {
	const stat = lstatIfPresent(path);
	if (!stat) return;
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
}

function mkdirIfNeeded(path: string): void {
	try {
		mkdirSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function taskTemplate(title: string, date: string): string {
	return `Status: planning
Created: ${date}
Updated: ${date}

# ${title}

## Intent

Pending shaping.

## Current State

Planning; pending shaping.

## Outcome

Pending shaping.
`;
}

function retrospectiveTemplate(date: string): string {
	return `Status: pending
Created: ${date}
Updated: ${date}

# Retrospective

## What Mattered

Pending completion of the undertaking.

## Learnings

Pending completion of the undertaking.

## Improvements

Pending completion of the undertaking.
`;
}

function readIndex(
	indexPath: string,
	heading: string,
	label: string,
	taskPath: string,
	duplicateError: string,
): string {
	let current = `${heading}\n`;
	if (pathExists(indexPath)) {
		assertRegularFile(indexPath, label);
		current = readFileSync(indexPath, "utf8");
	}
	const legacyHeading =
		heading === "# Task ledger" ? "# Task Ledger" : heading === "# Task history" ? "# Task History" : heading;
	if (
		!new RegExp(`^${escapeRegExp(heading)}\\s*$`, "m").test(current) &&
		!new RegExp(`^${escapeRegExp(legacyHeading)}\\s*$`, "m").test(current)
	) {
		throw new Error(`${label} must contain a '${heading}' heading`);
	}
	if (current.includes(`\`${taskPath}\``)) throw new Error(duplicateError);
	return current;
}

/** Replace a file through a sibling temporary so readers never see a truncated index. */
function writeAtomicTextFile(path: string, content: string): void {
	const directory = join(path, "..");
	const mode = pathExists(path) ? lstatSync(path).mode & 0o777 : undefined;
	const temporary = join(directory, `.${process.pid}.${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
		if (mode !== undefined) chmodSync(temporary, mode);
		fs.renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function acquireLedgerLease(root: string): () => void {
	return acquireExclusiveLease(LEDGER_LEASE_KIND, root, randomUUID(), {
		owned: (owner) => `${LEDGER_LEASE_BUSY}; owned by ${owner.pid}`,
		failed: LEDGER_LEASE_FAILED,
	});
}

function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((done) => {
		const finish = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", finish);
			done();
		};
		const timer = setTimeout(finish, ms);
		signal?.addEventListener("abort", finish, { once: true });
	});
}

/**
 * Session links follow other tools' changes, so they wait for a busy ledger instead of failing; ledger
 * transactions are short. Returns undefined when the session aborts first.
 */
async function acquireLedgerLeaseWhenFree(
	root: string,
	signal: AbortSignal | undefined,
): Promise<(() => void) | undefined> {
	while (!signal?.aborted) {
		try {
			return acquireLedgerLease(root);
		} catch (error) {
			const message = (error as Error).message;
			if (!message.startsWith(LEDGER_LEASE_BUSY) && message !== LEDGER_LEASE_FAILED) throw error;
			await pause(25, signal);
		}
	}
	return undefined;
}

function gitRevision(cwd: string, revision: string): string | undefined {
	try {
		return execFileSync("git", ["rev-parse", revision], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		// Outside a repository, before a first commit, or without git: there is no commit to point at.
		return undefined;
	}
}

/**
 * HEAD of the repository holding the ledger root, named by its top level relative to the root (`.` when they
 * match), or, for a parent-directory ledger, of each repository directly below it, named by its directory.
 */
function repositoryHeads(root: string): { repository: string; commit: string }[] {
	const top = gitRevision(root, "--show-toplevel");
	if (top !== undefined) {
		const commit = gitRevision(root, "HEAD");
		return commit ? [{ repository: relative(root, realpathSync(top)) || ".", commit }] : [];
	}
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && pathExists(join(root, entry.name, ".git")))
		.map((entry) => entry.name)
		.sort()
		.flatMap((repository) => {
			const commit = gitRevision(join(root, repository), "HEAD");
			return commit ? [{ repository, commit }] : [];
		});
}

/** Apply an update to a bundle's history.json and return a function that restores the previous file. */
function recordHistory(bundle: string, update: HistoryUpdate): () => void {
	const path = join(bundle, HISTORY_FILE);
	let previous: string | undefined;
	let history: LedgerHistory = { sessions: [], commits: [] };
	if (pathExists(path)) {
		assertRegularFile(path, HISTORY_FILE);
		previous = readFileSync(path, "utf8");
		history = JSON.parse(previous) as LedgerHistory;
		if (!Array.isArray(history.sessions) || !Array.isArray(history.commits)) {
			throw new Error(`${path} must hold sessions and commits arrays`);
		}
	}
	const at = new Date().toISOString();
	const { sessionId, via, event, heads = [] } = update;
	const linking = sessionId !== undefined && !history.sessions.some((session) => session.id === sessionId);
	if (linking) history.sessions.push({ id: sessionId, linkedAt: at, via });
	if (event) for (const head of heads) history.commits.push({ event, at, ...head });
	if (!linking && !(event && heads.length)) return () => {};
	writeAtomicTextFile(path, `${JSON.stringify(history, null, 2)}\n`);
	return () => (previous === undefined ? rmSync(path, { force: true }) : writeAtomicTextFile(path, previous));
}

/** Only sessions with a persisted transcript link; an ID without a session file would point at nothing. */
function linkableSession(ctx: ExtensionContext): string | undefined {
	return ctx.sessionManager.getSessionFile() ? ctx.sessionManager.getSessionId() : undefined;
}

/** Mirrors Pi's write/edit path resolution (`resolveToCwd`), which the package does not export. */
function resolveToolPath(input: string, cwd: string): string {
	let path = input.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
	if (path.startsWith("@")) path = path.slice(1);
	if (path === "~") path = homedir();
	else if (path.startsWith("~/")) path = join(homedir(), path.slice(2));
	else if (path.startsWith("file://")) path = fileURLToPath(path);
	return resolve(cwd, path);
}

/** The ledger root and task of the nearest `.ledger/<task-id>/` bundle holding a file. */
function owningBundle(file: string): { root: string; taskId: string } | undefined {
	const parts = file.split(sep);
	for (let index = parts.length - 3; index >= 0; index--) {
		const taskId = parts[index + 1] as string;
		if (parts[index] === ".ledger" && TASK_ID.test(taskId)) {
			return { root: parts.slice(0, index).join(sep) || sep, taskId };
		}
	}
	return undefined;
}

async function linkSession(
	root: string,
	taskId: string,
	sessionId: string,
	signal: AbortSignal | undefined,
): Promise<void> {
	const release = await acquireLedgerLeaseWhenFree(root, signal);
	if (!release) return;
	try {
		const live = join(root, ".ledger", taskId);
		const archived = join(root, ".ledger", "history", taskId);
		// A close that won the lease moved the bundle; the link follows it into history.
		const bundle = pathExists(live) ? live : pathExists(archived) ? archived : undefined;
		if (!bundle) return;
		assertDirectory(bundle, `.ledger bundle ${taskId}`);
		recordHistory(bundle, { sessionId, via: "edit" });
	} finally {
		release();
	}
}

/** Link a session whose write or edit changed a file inside a live task bundle, under that bundle's ledger root. */
async function linkChangedFile(
	cwd: string,
	path: string,
	sessionId: string,
	signal: AbortSignal | undefined,
): Promise<void> {
	let file: string;
	try {
		file = realpathSync(resolveToolPath(path, cwd));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	const owner = owningBundle(file);
	if (owner) await linkSession(owner.root, owner.taskId, sessionId, signal);
}

/** Live bundles under the session's directory and every ancestor that holds a `.ledger/`. */
function visibleLiveBundles(cwd: string): string[] {
	const bundles: string[] = [];
	let current = realpathSync(cwd);
	while (true) {
		const ledger = join(current, ".ledger");
		if (lstatIfPresent(ledger)?.isDirectory()) {
			for (const entry of readdirSync(ledger, { withFileTypes: true })) {
				if (entry.isDirectory() && TASK_ID.test(entry.name)) bundles.push(join(ledger, entry.name));
			}
		}
		const parent = dirname(current);
		if (parent === current) return bundles;
		current = parent;
	}
}

/**
 * Every file in a bundle with its modification time, status-change time, and size, in a canonical order, so
 * two signatures are equal exactly when no file was added, removed, or changed. The change time catches
 * tools that restore an older modification time (`cp -p`, `tar x`). The extension's own history.json and
 * atomic-write temporaries are excluded so another session's link does not look like this session's change.
 */
function bundleSignature(bundle: string): string | undefined {
	const files: string[] = [];
	try {
		for (const entry of readdirSync(bundle, { recursive: true, withFileTypes: true })) {
			const path = join(entry.parentPath, entry.name);
			if (!entry.isFile() || path === join(bundle, HISTORY_FILE) || /^\..*\.tmp$/.test(entry.name)) continue;
			const stat = fs.statSync(path, { bigint: true, throwIfNoEntry: false });
			if (stat) files.push(`${relative(bundle, path)}\0${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`);
		}
	} catch (error) {
		// The bundle was archived between listing and reading.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	return files.sort().join("\n");
}

function observeBundles(cwd: string): Map<string, string> {
	const signatures = new Map<string, string>();
	for (const bundle of visibleLiveBundles(cwd)) {
		const signature = bundleSignature(bundle);
		if (signature !== undefined) signatures.set(bundle, signature);
	}
	return signatures;
}

function indexRowPattern(taskPath: string): RegExp {
	const liveStatus = LIVE_STATUSES.map(escapeRegExp).join("|");
	return new RegExp(`^\\-\\s+\`${escapeRegExp(taskPath)}\`\\s+—\\s+(?:(?:${liveStatus})\\s+—\\s+)?(.+)$`, "m");
}

function removeIndexRow(content: string, taskPath: string): { next: string; summary?: string } {
	const pattern = indexRowPattern(taskPath);
	const match = pattern.exec(content);
	if (!match) return { next: content };
	const next = content.replace(pattern, "").replace(/\n{3,}/g, "\n\n");
	return { next, summary: match[1]?.trim() };
}

function titleFromTask(taskMarkdown: string, fallback: string): string {
	return taskMarkdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function writeTextFile(path: string, content: string): void {
	writeAtomicTextFile(path, content);
}

function applyTaskStatus(taskMarkdown: string, status: LedgerStatus): string {
	if (/^Status:\s+\S+\s*$/m.test(taskMarkdown)) {
		return taskMarkdown.replace(/^Status:\s+\S+\s*$/m, `Status: ${status}`);
	}
	return `Status: ${status}\n${taskMarkdown}`;
}

function parseTaskId(input: string): string {
	const value = input.trim().replaceAll("\\", "/").replace(/\/+$/, "");
	const withoutFile = value.replace(/\/task\.md$/i, "");
	const parts = withoutFile.split("/").filter(Boolean);
	const taskId = parts.at(-1) ?? "";
	if (!TASK_ID.test(taskId)) throw new Error("task must be a YYYYMMDDhhmm-kebab-slug id or .ledger path");
	if (parts.includes("history")) throw new Error(`The ledger task is already archived: .ledger/history/${taskId}`);
	return taskId;
}

function parseStatus(value: string): LedgerStatus {
	if ((STATUSES as readonly string[]).includes(value)) return value as LedgerStatus;
	throw new Error(`status must be one of ${STATUSES.join(", ")}`);
}

function isLiveStatus(status: LedgerStatus): status is LiveLedgerStatus {
	return (LIVE_STATUSES as readonly string[]).includes(status);
}

export async function addLedgerTask(
	rootInput: string,
	titleInput: string,
	descriptionInput: string,
	slugInput?: string,
	now = new Date(),
	sessionId?: string,
): Promise<AddedLedgerTask> {
	const root = realpathSync(rootInput);
	const title = normalizedLine(titleInput, "title", 160);
	const description = normalizedLine(descriptionInput, "description", 400);
	const slug = slugFrom(title, slugInput);
	const { stamp, date } = localStamp(now);
	const taskId = `${stamp}-${slug}`;
	const ledgerPath = join(root, ".ledger");
	const indexAbsolute = join(ledgerPath, "INDEX.md");
	const bundleAbsolute = join(ledgerPath, taskId);
	const historyBundleAbsolute = join(ledgerPath, "history", taskId);
	const taskAbsolute = join(bundleAbsolute, "task.md");
	const retrospectiveAbsolute = join(bundleAbsolute, "retrospective.md");
	const bundlePath = `.ledger/${taskId}`;
	const taskPath = `${bundlePath}/task.md`;

	const release = acquireLedgerLease(root);
	try {
		mkdirIfNeeded(ledgerPath);
		assertDirectory(ledgerPath, ".ledger");
		if (pathExists(bundleAbsolute)) throw new Error(`The ledger task already exists: ${bundlePath}`);
		const historyPath = join(ledgerPath, "history");
		if (pathExists(historyPath)) assertDirectory(historyPath, ".ledger/history");
		if (pathExists(historyBundleAbsolute)) {
			throw new Error(`The ledger task is already archived: .ledger/history/${taskId}`);
		}
		const currentIndex = readIndex(
			indexAbsolute,
			"# Task ledger",
			LIVE_INDEX,
			taskPath,
			`The ledger index already contains ${taskPath}`,
		);
		const nextIndex = `${currentIndex.replace(/\n*$/, "\n")}\n- \`${taskPath}\` — planning — ${title} — ${description}\n`;

		let createdBundle = false;
		try {
			mkdirSync(bundleAbsolute);
			createdBundle = true;
			writeFileSync(taskAbsolute, taskTemplate(title, date), { encoding: "utf8", flag: "wx" });
			writeFileSync(retrospectiveAbsolute, retrospectiveTemplate(date), { encoding: "utf8", flag: "wx" });
			if (sessionId) recordHistory(bundleAbsolute, { sessionId, via: "ledger_add" });
			writeAtomicTextFile(indexAbsolute, nextIndex);
			return { taskId, bundlePath, taskPath, indexPath: LIVE_INDEX };
		} catch (error) {
			if (createdBundle) rmSync(bundleAbsolute, { recursive: true, force: true });
			throw error;
		}
	} finally {
		release();
	}
}

export async function transitionLedgerTask(
	rootInput: string,
	taskInput: string,
	statusInput: string,
	sessionId?: string,
): Promise<TransitionedLedgerTask> {
	const root = realpathSync(rootInput);
	const taskId = parseTaskId(taskInput);
	const status = parseStatus(statusInput);
	const history: HistoryUpdate = { sessionId, via: "ledger_status" };
	if (status === "in-progress" || !isLiveStatus(status)) {
		history.event = status;
		history.heads = repositoryHeads(root);
	}
	const release = acquireLedgerLease(root);
	try {
		return isLiveStatus(status)
			? updateLiveTask(root, taskId, status, history)
			: archiveTask(root, taskId, status, history);
	} finally {
		release();
	}
}

function updateLiveTask(
	root: string,
	taskId: string,
	status: LiveLedgerStatus,
	history: HistoryUpdate,
): TransitionedLedgerTask {
	const ledgerPath = join(root, ".ledger");
	const indexAbsolute = join(ledgerPath, "INDEX.md");
	const bundleAbsolute = join(ledgerPath, taskId);
	const taskAbsolute = join(bundleAbsolute, "task.md");
	const taskPath = `.ledger/${taskId}/task.md`;
	assertDirectory(ledgerPath, ".ledger");
	if (pathExists(join(ledgerPath, "history", taskId)))
		throw new Error(`The ledger task is already archived: .ledger/history/${taskId}`);
	if (!pathExists(bundleAbsolute)) throw new Error(`Requested ledger task not found: .ledger/${taskId}`);
	assertDirectory(bundleAbsolute, `.ledger/${taskId}`);
	if (!pathExists(taskAbsolute)) throw new Error(`The ledger task is missing task.md: ${taskPath}`);
	assertRegularFile(taskAbsolute, taskPath);

	const task = readFileSync(taskAbsolute, "utf8");
	const currentIndex = readIndex(
		indexAbsolute,
		"# Task ledger",
		LIVE_INDEX,
		`.ledger/history/${taskId}/task.md`,
		"The ledger index has an invalid history row",
	);
	const removed = removeIndexRow(currentIndex, taskPath);
	const row = `- \`${taskPath}\` — ${status} — ${removed.summary || titleFromTask(task, taskId)}`;
	const nextIndex = removed.summary
		? currentIndex.replace(indexRowPattern(taskPath), row)
		: `${currentIndex.replace(/\n*$/, "\n")}\n${row}\n`;
	const restoreHistory = recordHistory(bundleAbsolute, history);
	let taskChanged = false;
	try {
		writeTextFile(taskAbsolute, applyTaskStatus(task, status));
		taskChanged = true;
		writeAtomicTextFile(indexAbsolute, nextIndex);
	} catch (error) {
		if (taskChanged) writeTextFile(taskAbsolute, task);
		restoreHistory();
		throw error;
	}
	return { taskId, status, bundlePath: `.ledger/${taskId}`, taskPath, indexPath: LIVE_INDEX };
}

function archiveTask(
	root: string,
	taskId: string,
	status: ClosedLedgerStatus,
	history: HistoryUpdate,
): TransitionedLedgerTask {
	const ledgerPath = join(root, ".ledger");
	const historyPath = join(ledgerPath, "history");
	const liveIndexAbsolute = join(ledgerPath, "INDEX.md");
	const historyIndexAbsolute = join(historyPath, "INDEX.md");
	const liveBundleAbsolute = join(ledgerPath, taskId);
	const liveTaskAbsolute = join(liveBundleAbsolute, "task.md");
	const historyBundleAbsolute = join(historyPath, taskId);
	const liveTaskPath = `.ledger/${taskId}/task.md`;
	const historyTaskPath = `.ledger/history/${taskId}/task.md`;

	assertDirectory(ledgerPath, ".ledger");
	// Read and validate every source and destination before changing task.md.
	if (pathExists(historyBundleAbsolute))
		throw new Error(`The ledger task is already archived: .ledger/history/${taskId}`);
	if (!pathExists(liveBundleAbsolute)) throw new Error(`Requested ledger task not found: .ledger/${taskId}`);
	assertDirectory(liveBundleAbsolute, `.ledger/${taskId}`);
	if (!pathExists(liveTaskAbsolute)) throw new Error(`The ledger task is missing task.md: ${liveTaskPath}`);
	assertRegularFile(liveTaskAbsolute, liveTaskPath);
	if (pathExists(historyPath)) assertDirectory(historyPath, ".ledger/history");

	const liveTask = readFileSync(liveTaskAbsolute, "utf8");
	const nextTask = applyTaskStatus(liveTask, status);
	const currentLiveIndex = readIndex(
		liveIndexAbsolute,
		"# Task ledger",
		LIVE_INDEX,
		historyTaskPath,
		"The ledger index has an invalid history row",
	);
	const currentHistoryIndex = readIndex(
		historyIndexAbsolute,
		"# Task history",
		HISTORY_INDEX,
		historyTaskPath,
		`History index already contains ${historyTaskPath}`,
	);
	const removed = removeIndexRow(currentLiveIndex, liveTaskPath);
	const summary = removed.summary || titleFromTask(nextTask, taskId);
	const nextHistoryIndex = `${currentHistoryIndex.replace(/\n*$/, "\n")}\n- \`${historyTaskPath}\` — ${status} — ${summary}\n`;

	const historyExisted = pathExists(historyPath);
	const historyIndexExisted = pathExists(historyIndexAbsolute);
	let taskChanged = false;
	let moved = false;
	let liveIndexChanged = false;
	let historyIndexChanged = false;
	let historyCreated = false;
	let restoreHistory: (() => void) | undefined;
	try {
		// Stage the destination path before changing task metadata.
		mkdirIfNeeded(historyPath);
		historyCreated = !historyExisted;
		assertDirectory(historyPath, ".ledger/history");
		// The close commit and session link travel with the bundle into history.
		restoreHistory = recordHistory(liveBundleAbsolute, history);
		if (nextTask !== liveTask) {
			writeTextFile(liveTaskAbsolute, nextTask);
			taskChanged = true;
		}
		fs.renameSync(liveBundleAbsolute, historyBundleAbsolute);
		moved = true;
		if (removed.next !== currentLiveIndex) {
			writeAtomicTextFile(liveIndexAbsolute, removed.next);
			liveIndexChanged = true;
		}
		writeAtomicTextFile(historyIndexAbsolute, nextHistoryIndex);
		historyIndexChanged = true;
	} catch (error) {
		// Restore indexes first, then return the bundle and its original status.
		try {
			if (historyIndexChanged) {
				if (historyIndexExisted) writeAtomicTextFile(historyIndexAbsolute, currentHistoryIndex);
				else rmSync(historyIndexAbsolute, { force: true });
			}
			if (liveIndexChanged) writeAtomicTextFile(liveIndexAbsolute, currentLiveIndex);
			if (moved) fs.renameSync(historyBundleAbsolute, liveBundleAbsolute);
			if (taskChanged) writeTextFile(liveTaskAbsolute, liveTask);
			restoreHistory?.();
			if (historyCreated) rmSync(historyPath, { recursive: false, force: true });
		} catch (rollbackError) {
			throw new Error(`The ledger archive failed and rollback failed: ${(rollbackError as Error).message}`, {
				cause: error,
			});
		}
		throw error;
	}
	return {
		taskId,
		status,
		bundlePath: `.ledger/history/${taskId}`,
		taskPath: historyTaskPath,
		indexPath: HISTORY_INDEX,
	};
}

function createLedgerAddTool() {
	return defineTool({
		name: "ledger_add",
		label: "Add to ledger",
		description:
			"Create one new timestamped .ledger task bundle with task.md, retrospective.md, and a live index row. Add plans, specifications, notes, decisions, evidence, or assets later only when useful. Not for listing, inspecting, selecting, updating, closing, or executing existing tasks.",
		promptSnippet: "Add a new .ledger task bundle when the user asks to create one",
		parameters: Type.Object({
			title: Type.String({ description: "One-line task title, 1-160 characters." }),
			description: Type.String({
				description:
					"One-line search summary, 1-400 characters. Stored on the live index row and carried into history.",
			}),
			slug: Type.Optional(
				Type.String({ description: "Optional lowercase kebab slug. Defaults to a slug derived from the title." }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.isProjectTrusted()) throw new Error("Adding a ledger task requires a trusted session repository");
			const result = await addLedgerTask(
				ctx.cwd,
				params.title,
				params.description,
				params.slug,
				new Date(),
				linkableSession(ctx),
			);
			return {
				content: [{ type: "text" as const, text: `Added ${result.taskPath}` }],
				details: result,
			};
		},
		renderCall(args, theme) {
			return new Text(`${theme.fg("toolTitle", theme.bold("Add to ledger "))}${theme.fg("accent", args.title)}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const content = result.content[0]?.type === "text" ? result.content[0].text : "No output";
			return new Text(theme.fg("dim", content), 0, 0);
		},
	});
}

function createLedgerStatusTool() {
	return defineTool({
		name: "ledger_status",
		label: "Set ledger task status",
		description:
			"Move one live .ledger task to a new status. planning, ready, and in-progress update Status in task.md and on the live index row. done and cancelled archive the bundle into .ledger/history and move the row to the history index; call them only after edits to the bundle are committed. Not for creating, inspecting, shaping, executing, or judging completeness.",
		promptSnippet: "Move a ledger task between planning, ready, in-progress, done, and cancelled",
		parameters: Type.Object({
			task: Type.String({
				description: "Task id, .ledger/<id>, or .ledger/<id>/task.md of the live task.",
			}),
			status: Type.Union(
				STATUSES.map((status) => Type.Literal(status)),
				{ description: "New status. done and cancelled archive the task." },
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.isProjectTrusted()) throw new Error("Changing a ledger task requires a trusted session repository");
			const result = await transitionLedgerTask(ctx.cwd, params.task, params.status, linkableSession(ctx));
			const verb = isLiveStatus(result.status) ? "Moved" : "Archived";
			return {
				content: [{ type: "text" as const, text: `${verb} ${result.taskPath} to ${result.status}` }],
				details: result,
			};
		},
		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("Set ledger status "))}${theme.fg("accent", `${args.status} ${args.task}`)}`,
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const content = result.content[0]?.type === "text" ? result.content[0].text : "No output";
			return new Text(theme.fg("dim", content), 0, 0);
		},
	});
}

export default function installLedger(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event) =>
		setSystemPromptSection(event.systemPromptOptions, LEDGER_SYSTEM_PROMPT_TAG, LEDGER_SYSTEM_PROMPT),
	);
	pi.registerTool(createLedgerAddTool());
	pi.registerTool(createLedgerStatusTool());
	// Bundle signatures seen before each bash or pi_exec call, per session; their changes are found by comparison.
	const observed = new Map<string, Map<string, string>>();
	pi.on("tool_call", (event, ctx) => {
		const sessionId = linkableSession(ctx);
		if (sessionId && OPAQUE_CHANGE_TOOLS.has(event.toolName)) observed.set(sessionId, observeBundles(ctx.cwd));
	});
	// No trust gate: the session already changed the bundle, and workers may run untrusted.
	pi.on("tool_result", async (event, ctx) => {
		const sessionId = linkableSession(ctx);
		if (!sessionId) return;
		if (event.toolName === "write" || event.toolName === "edit") {
			if (!event.isError && typeof event.input.path === "string") {
				await linkChangedFile(ctx.cwd, event.input.path, sessionId, ctx.signal);
			}
			return;
		}
		const before = OPAQUE_CHANGE_TOOLS.has(event.toolName) ? observed.get(sessionId) : undefined;
		if (!before) return;
		const after = observeBundles(ctx.cwd);
		observed.set(sessionId, after);
		for (const [bundle, signature] of after) {
			const previous = before.get(bundle);
			if (previous === undefined || previous === signature) continue;
			await linkSession(dirname(dirname(bundle)), basename(bundle), sessionId, ctx.signal);
		}
	});
}
