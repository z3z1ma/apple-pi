import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
		owned: (owner) => `A ledger transaction is busy; owned by ${owner.pid}`,
		failed: "Unable to acquire the ledger transaction lease",
	});
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
): Promise<TransitionedLedgerTask> {
	const root = realpathSync(rootInput);
	const taskId = parseTaskId(taskInput);
	const status = parseStatus(statusInput);
	const release = acquireLedgerLease(root);
	try {
		return isLiveStatus(status) ? updateLiveTask(root, taskId, status) : archiveTask(root, taskId, status);
	} finally {
		release();
	}
}

function updateLiveTask(root: string, taskId: string, status: LiveLedgerStatus): TransitionedLedgerTask {
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
	writeTextFile(taskAbsolute, applyTaskStatus(task, status));
	try {
		writeAtomicTextFile(indexAbsolute, nextIndex);
	} catch (error) {
		writeTextFile(taskAbsolute, task);
		throw error;
	}
	return { taskId, status, bundlePath: `.ledger/${taskId}`, taskPath, indexPath: LIVE_INDEX };
}

function archiveTask(root: string, taskId: string, status: ClosedLedgerStatus): TransitionedLedgerTask {
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
	try {
		// Stage the destination path before changing task metadata.
		mkdirIfNeeded(historyPath);
		historyCreated = !historyExisted;
		assertDirectory(historyPath, ".ledger/history");
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
			const result = await addLedgerTask(ctx.cwd, params.title, params.description, params.slug);
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
			"Move one live .ledger task to a new status. planning, ready, and in-progress update Status in task.md and on the live index row. done and cancelled archive the bundle into .ledger/history and move the row to the history index; call them only after edits to the bundle are written and committed, never alongside those edits. Not for creating, inspecting, shaping, executing, or judging completeness.",
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
			const result = await transitionLedgerTask(ctx.cwd, params.task, params.status);
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
}
