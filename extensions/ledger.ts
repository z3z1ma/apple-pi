import {
	appendFileSync,
	chmodSync,
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { appendLedgerSystemPrompt } from "../components/shared/src/ledger-system-prompt.js";

const SUPPORTING_DIRECTORIES = ["specs", "plans", "research", "decisions", "evidence"] as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TASK_ID = /^\d{12}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CLOSED_STATUSES = ["done", "cancelled"] as const;
const LIVE_INDEX = ".ledger/INDEX.md";
const HISTORY_INDEX = ".ledger/history/INDEX.md";

export const LEDGER_EXTENSION_PATH = fileURLToPath(import.meta.url);

export type ClosedLedgerStatus = (typeof CLOSED_STATUSES)[number];

export interface AddedLedgerTask {
	taskId: string;
	bundlePath: string;
	taskPath: string;
	indexPath: string;
}

export interface ClosedLedgerTask {
	taskId: string;
	status: ClosedLedgerStatus;
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

function assertDirectory(path: string, label: string): void {
	if (!existsSync(path)) return;
	const stat = lstatSync(path);
	if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a non-symlink directory`);
}

function assertRegularFile(path: string, label: string): void {
	if (!existsSync(path)) return;
	const stat = lstatSync(path);
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
	return `Status: open
Created: ${date}
Updated: ${date}

# ${title}

## Intent

Pending shaping.

## Outcome

Pending shaping.

## Scope

Pending shaping.

## Non-goals

- Pending shaping.

## Acceptance Criteria

- AC-001: Pending shaping.

## Constraints

- Pending shaping.

## References

- Pending shaping.
`;
}

function retrospectiveTemplate(date: string): string {
	return `Status: pending
Created: ${date}
Updated: ${date}

# Retrospective

## Summary

Pending completion of the undertaking.

## What Worked

Pending completion of the undertaking.

## What Could Improve

Pending completion of the undertaking.

## Learnings

Pending completion of the undertaking.

## Improvements

Pending completion of the undertaking.
`;
}

function ensureIndex(indexPath: string, directory: string, heading: string, label: string): void {
	if (!existsSync(indexPath)) {
		const temporary = join(directory, `.index.${process.pid}.${Date.now()}.tmp`);
		try {
			writeFileSync(temporary, `${heading}\n`, { encoding: "utf8", flag: "wx" });
			try {
				linkSync(temporary, indexPath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		} finally {
			rmSync(temporary, { force: true });
		}
	}
	assertRegularFile(indexPath, label);
}

function validateLiveIndex(indexPath: string, taskPath: string): void {
	const current = readFileSync(indexPath, "utf8");
	if (!/^#\s+Task Ledger\s*$/m.test(current)) {
		throw new Error(".ledger/INDEX.md must contain a '# Task Ledger' heading");
	}
	if (current.includes(`\`${taskPath}\``)) throw new Error(`Ledger index already contains ${taskPath}`);
}

function validateHistoryIndex(indexPath: string, taskPath: string): void {
	const current = readFileSync(indexPath, "utf8");
	if (!/^#\s+Task History\s*$/m.test(current)) {
		throw new Error(".ledger/history/INDEX.md must contain a '# Task History' heading");
	}
	if (current.includes(`\`${taskPath}\``)) throw new Error(`History index already contains ${taskPath}`);
}

function removeIndexRow(content: string, taskPath: string): { next: string; summary?: string } {
	const pattern = new RegExp(`^\\-\\s+\`${escapeRegExp(taskPath)}\`\\s+—\\s+(.+)$`, "m");
	const match = pattern.exec(content);
	if (!match) return { next: content };
	const next = content.replace(pattern, "").replace(/\n{3,}/g, "\n\n");
	return { next, summary: match[1]?.trim() };
}

function titleFromTask(taskMarkdown: string, fallback: string): string {
	return taskMarkdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function writeTextFile(path: string, content: string): void {
	const mode = existsSync(path) ? lstatSync(path).mode & 0o777 : undefined;
	writeFileSync(path, content, "utf8");
	if (mode !== undefined) chmodSync(path, mode);
}

function applyTaskStatus(taskMarkdown: string, status: ClosedLedgerStatus): string {
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
	if (parts.includes("history")) throw new Error(`Ledger task already archived: .ledger/history/${taskId}`);
	return taskId;
}

function parseClosedStatus(value: string): ClosedLedgerStatus {
	if ((CLOSED_STATUSES as readonly string[]).includes(value)) return value as ClosedLedgerStatus;
	throw new Error("status must be done or cancelled");
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

	mkdirIfNeeded(ledgerPath);
	assertDirectory(ledgerPath, ".ledger");
	if (existsSync(bundleAbsolute)) throw new Error(`Ledger task already exists: ${bundlePath}`);
	if (existsSync(historyBundleAbsolute)) {
		throw new Error(`Ledger task already archived: .ledger/history/${taskId}`);
	}
	ensureIndex(indexAbsolute, ledgerPath, "# Task Ledger", LIVE_INDEX);
	validateLiveIndex(indexAbsolute, taskPath);

	let createdBundle = false;
	try {
		mkdirSync(bundleAbsolute);
		createdBundle = true;
		for (const directory of SUPPORTING_DIRECTORIES) mkdirSync(join(bundleAbsolute, directory));
		writeFileSync(taskAbsolute, taskTemplate(title, date), { encoding: "utf8", flag: "wx" });
		writeFileSync(retrospectiveAbsolute, retrospectiveTemplate(date), { encoding: "utf8", flag: "wx" });
		appendFileSync(indexAbsolute, `\n- \`${taskPath}\` — ${title} — ${description}\n`, "utf8");
		return { taskId, bundlePath, taskPath, indexPath: LIVE_INDEX };
	} catch (error) {
		if (createdBundle) rmSync(bundleAbsolute, { recursive: true, force: true });
		throw error;
	}
}

export async function closeLedgerTask(
	rootInput: string,
	taskInput: string,
	statusInput: string,
): Promise<ClosedLedgerTask> {
	const root = realpathSync(rootInput);
	const taskId = parseTaskId(taskInput);
	const status = parseClosedStatus(statusInput);
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
	if (existsSync(historyBundleAbsolute)) throw new Error(`Ledger task already archived: .ledger/history/${taskId}`);
	if (!existsSync(liveBundleAbsolute)) throw new Error(`Ledger task not found: .ledger/${taskId}`);
	assertDirectory(liveBundleAbsolute, `.ledger/${taskId}`);
	if (!existsSync(liveTaskAbsolute)) throw new Error(`Ledger task is missing task.md: ${liveTaskPath}`);
	assertRegularFile(liveTaskAbsolute, liveTaskPath);

	const liveTask = readFileSync(liveTaskAbsolute, "utf8");
	const nextTask = applyTaskStatus(liveTask, status);
	if (nextTask !== liveTask) writeTextFile(liveTaskAbsolute, nextTask);

	mkdirIfNeeded(historyPath);
	assertDirectory(historyPath, ".ledger/history");
	ensureIndex(historyIndexAbsolute, historyPath, "# Task History", HISTORY_INDEX);
	validateHistoryIndex(historyIndexAbsolute, historyTaskPath);

	let liveIndexSummary: string | undefined;
	let nextLiveIndex: string | undefined;
	if (existsSync(liveIndexAbsolute)) {
		assertRegularFile(liveIndexAbsolute, LIVE_INDEX);
		const currentLiveIndex = readFileSync(liveIndexAbsolute, "utf8");
		const removed = removeIndexRow(currentLiveIndex, liveTaskPath);
		liveIndexSummary = removed.summary;
		if (removed.next !== currentLiveIndex) nextLiveIndex = removed.next;
	}

	renameSync(liveBundleAbsolute, historyBundleAbsolute);
	if (nextLiveIndex !== undefined) writeTextFile(liveIndexAbsolute, nextLiveIndex);
	const summary = liveIndexSummary || titleFromTask(nextTask, taskId);
	appendFileSync(historyIndexAbsolute, `\n- \`${historyTaskPath}\` — ${status} — ${summary}\n`, "utf8");
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
		label: "Ledger Add",
		description:
			"Create one new timestamped .ledger task bundle, its full supporting directory tree, structural task.md, and live index row with title and description. Not for listing, inspecting, selecting, updating, closing, or executing existing tasks.",
		promptSnippet: "Add a new .ledger task bundle when the user asks to create one",
		promptGuidelines: [
			"Use ledger_add only to create a new ledger task; read and edit existing .ledger files with ordinary repository tools.",
		],
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
			return new Text(`${theme.fg("toolTitle", theme.bold("Ledger Add "))}${theme.fg("accent", args.title)}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const content = result.content[0]?.type === "text" ? result.content[0].text : "No output";
			return new Text(theme.fg("dim", content), 0, 0);
		},
	});
}

function createLedgerCloseTool() {
	return defineTool({
		name: "ledger_close",
		label: "Ledger Close",
		description:
			"Archive one live .ledger task into .ledger/history with a terminal status of done or cancelled. Updates Status in task.md when needed, moves the bundle, and transfers the index row including that status, title, and description. Not for creating, inspecting, shaping, executing, or judging completeness.",
		promptSnippet: "Close or cancel a ledger task by archiving it into .ledger/history",
		promptGuidelines: [
			"Use ledger_close only to archive a live task as done or cancelled. It does not verify acceptance criteria or work items.",
		],
		parameters: Type.Object({
			task: Type.String({
				description: "Task id, .ledger/<id>, or .ledger/<id>/task.md of the live task to archive.",
			}),
			status: Type.Union([Type.Literal("done"), Type.Literal("cancelled")], {
				description: "Terminal status to record on the task and in the history index.",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.isProjectTrusted()) throw new Error("Ledger closing requires a trusted session repository");
			const result = await closeLedgerTask(ctx.cwd, params.task, params.status);
			return {
				content: [{ type: "text" as const, text: `Archived ${result.taskPath} as ${result.status}` }],
				details: result,
			};
		},
		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("Ledger Close "))}${theme.fg("accent", `${args.status} ${args.task}`)}`,
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
	pi.on("before_agent_start", (event) => ({ systemPrompt: appendLedgerSystemPrompt(event.systemPrompt ?? "") }));
	pi.registerTool(createLedgerAddTool());
	pi.registerTool(createLedgerCloseTool());
}
