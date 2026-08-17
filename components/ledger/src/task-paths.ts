import { posix } from "node:path";

export const LEDGER_ROOT = ".ledger";
export const LEDGER_INDEX_PATH = ".ledger/README.md";

export type RecordKind = "task" | "spec" | "plan" | "decision" | "research" | "evidence" | "knowledge" | "skill";

const TASK_ID = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export interface TaskLocation {
	taskId: string;
	bundlePath: string;
	taskPath: string;
}

export function validTaskId(value: string): boolean {
	const match = TASK_ID.exec(value);
	if (!match) return false;
	const [, year, month, day, hour, minute] = match;
	const timestamp = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
	return (
		timestamp.getUTCFullYear() === Number(year) &&
		timestamp.getUTCMonth() + 1 === Number(month) &&
		timestamp.getUTCDate() === Number(day) &&
		timestamp.getUTCHours() === Number(hour) &&
		timestamp.getUTCMinutes() === Number(minute)
	);
}

export function taskLocation(path: string): TaskLocation | undefined {
	const normalized = posix.normalize(path);
	if (normalized !== path || path.startsWith("/") || path.includes("\\")) return undefined;
	const match = /^\.ledger\/([^/]+)\/task\.md$/.exec(path);
	if (!match || !validTaskId(match[1])) return undefined;
	return { taskId: match[1], bundlePath: `.ledger/${match[1]}`, taskPath: path };
}

export function bundleForRecord(path: string): string | undefined {
	const normalized = posix.normalize(path);
	if (normalized !== path || path.startsWith("/") || path.includes("\\")) return undefined;
	const match = /^\.ledger\/([^/]+)\//.exec(path);
	return match && validTaskId(match[1]) ? `.ledger/${match[1]}` : undefined;
}

export function recordKindForPath(path: string): RecordKind | undefined {
	const task = taskLocation(path);
	if (task) return "task";
	const bundle = bundleForRecord(path);
	if (!bundle) return undefined;
	const relative = path.slice(bundle.length + 1);
	if (/^specs\/.+\.md$/.test(relative)) return "spec";
	if (/^plans\/.+\.md$/.test(relative)) return "plan";
	if (/^decisions\/.+\.md$/.test(relative)) return "decision";
	if (/^research\/.+\.md$/.test(relative)) return "research";
	if (/^evidence\/.+\.md$/.test(relative)) return "evidence";
	if (/^knowledge\/.+\.md$/.test(relative)) return "knowledge";
	if (/^skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(relative)) return "skill";
	return undefined;
}
