import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AcceptanceCriterion, CompiledWorkGraph, RecordKind, WorkRecord } from "./types.js";
import { parseTaskDocument } from "./task-document.js";
import { LEDGER_INDEX_PATH, bundleForRecord, recordKindForPath, taskLocation } from "./task-paths.js";

const REQUIRED_TASK_SECTIONS = [
	"scope",
	"non-goals",
	"acceptance criteria",
	"references",
	"assumptions",
	"journal",
	"blockers",
	"evidence",
	"review",
	"retrospective",
	"distillation",
] as const;

const FOLLOW_SECTIONS = new Set(["references", "related records", "relates-to", "authority and provenance"]);

const KIND_ORDER: Record<RecordKind, number> = {
	task: 0,
	spec: 1,
	decision: 2,
	plan: 3,
	research: 4,
	knowledge: 5,
	skill: 6,
	evidence: 7,
};

export interface WorkGraphLimits {
	maxRecords?: number;
	maxBytes?: number;
}

export class WorkGraphError extends Error {
	constructor(message: string, readonly code: string) {
		super(message);
		this.name = "WorkGraphError";
	}
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function byteSort(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeProjectPath(projectRoot: string, input: string): string {
	const root = realpathSync(projectRoot);
	const absolute = isAbsolute(input) ? resolve(input) : resolve(root, input);
	let real: string;
	try {
		real = realpathSync(absolute);
	} catch {
		throw new WorkGraphError(`Referenced record does not exist: ${input}`, "missing_record");
	}
	const rel = relative(root, real).split(sep).join("/");
	if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
		throw new WorkGraphError(`Record escapes the project root: ${input}`, "path_escape");
	}
	if (lstatSync(absolute).isSymbolicLink() || real !== absolute) {
		throw new WorkGraphError(`Symlinked records are not allowed: ${input}`, "symlink_record");
	}
	return rel;
}

function parseHeaders(content: string): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const line of content.split(/\r?\n/)) {
		if (/^#\s/.test(line)) break;
		const match = /^([A-Za-z][A-Za-z -]*):\s*(.*?)\s*$/.exec(line);
		if (!match) continue;
		const key = match[1].toLowerCase();
		if (headers[key] !== undefined) throw new WorkGraphError(`Duplicate record header: ${match[1]}`, "duplicate_header");
		headers[key] = match[2];
	}
	return headers;
}

function parseSections(content: string): Map<string, string> {
	const sections = new Map<string, string>();
	const matches = [...content.matchAll(/^##\s+(.+?)\s*$/gm)];
	for (let index = 0; index < matches.length; index++) {
		const match = matches[index];
		const heading = match[1].trim().toLowerCase();
		if (sections.has(heading)) throw new WorkGraphError(`Duplicate record section: ${match[1].trim()}`, "duplicate_section");
		const start = (match.index ?? 0) + match[0].length;
		const end = matches[index + 1]?.index ?? content.length;
		sections.set(heading, content.slice(start, end).trim());
	}
	return sections;
}

function recordPaths(text: string): string[] {
	for (const match of text.matchAll(/(?:^|[\s`(])([^\s`),;]*\.ledger\/[^\s`),;]+)/g)) {
		const token = match[1].replace(/[.;:]+$/, "");
		if (!token.startsWith(".ledger/")) throw new WorkGraphError(`Ledger reference must be project-relative without traversal: ${token}`, "path_escape");
	}
	const matches = text.match(/(?<![A-Za-z0-9._/-])\.ledger\/[A-Za-z0-9._/-]+(?:\.md|\/SKILL\.md)/g) ?? [];
	return [...new Set(matches.map((path) => path.replace(/[),.;:]+$/, "")))].sort(byteSort);
}

function sourcePaths(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(/`([^`\n]+)`/g)) {
		const candidate = match[1].trim();
		if (!candidate.startsWith(".ledger/") && /^[A-Za-z0-9._/-]+$/.test(candidate)) found.add(candidate);
	}
	return [...found].sort(byteSort);
}

function splitHeaderPaths(value: string | undefined): string[] {
	if (!value) return [];
	return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function referenceText(record: WorkRecord, root: boolean): string {
	if (root) return record.sections.get("references") ?? "";
	if (record.kind === "task") return "";
	const texts: string[] = [];
	for (const [heading, body] of record.sections) {
		if (FOLLOW_SECTIONS.has(heading)) texts.push(body);
	}
	return texts.join("\n");
}

function loadRecord(projectRoot: string, path: string): WorkRecord {
	const normalized = normalizeProjectPath(projectRoot, path);
	if (!normalized.startsWith(".ledger/")) throw new WorkGraphError(`Only .ledger records can enter the semantic graph: ${path}`, "non_record_reference");
	const kind = recordKindForPath(normalized);
	if (!kind) throw new WorkGraphError(`Unknown task-bundle record path: ${normalized}`, "unknown_record_kind");
	const absolutePath = resolve(realpathSync(projectRoot), normalized);
	const content = readFileSync(absolutePath, "utf8");
	if (kind === "skill") {
		const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1] ?? "";
		const expectedName = normalized.split("/").at(-2);
		const name = /^name:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/m.exec(frontmatter)?.[1];
		const description = /^description:\s*["']?(.+?)["']?\s*$/m.exec(frontmatter)?.[1];
		if (name !== expectedName || !description?.trim()) throw new WorkGraphError(`Task skill must have matching name and description frontmatter: ${normalized}`, "invalid_task_skill");
	}
	const taskDocument = kind === "task" ? parseTaskDocument(content) : undefined;
	const headers = taskDocument?.headers ?? parseHeaders(content);
	if (kind === "task") {
		const location = taskLocation(normalized);
		const created = headers.created;
		if (!location || !/^\d{4}-\d{2}-\d{2}$/.test(created ?? "") || created?.replaceAll("-", "") !== location.taskId.slice(0, 8)) {
			throw new WorkGraphError(`Task Created date must match its directory timestamp: ${normalized}`, "task_date_mismatch");
		}
	}
	return {
		path: normalized,
		absolutePath,
		kind,
		status: headers.status?.toLowerCase(),
		content,
		digest: sha256(content),
		headers,
		sections: taskDocument?.sections ?? parseSections(content),
		references: [],
		...(taskDocument && { taskDocument }),
	};
}

function requireStatus(record: WorkRecord, allowed: string[], relationship: string): void {
	if (!record.status || !allowed.includes(record.status)) {
		throw new WorkGraphError(`${relationship} ${record.path} has status ${record.status ?? "(missing)"}; expected ${allowed.join(" or ")}`, "inactive_authority");
	}
	if (record.path.includes("/superseded/") || record.path.includes("/cancelled/")) {
		throw new WorkGraphError(`${relationship} is terminal authority: ${record.path}`, "terminal_authority");
	}
}

function validateSupportingRecord(record: WorkRecord): void {
	if (record.kind === "spec" || record.kind === "decision" || record.kind === "knowledge") {
		requireStatus(record, ["active"], `Referenced ${record.kind}`);
	} else if (record.kind === "plan" || record.kind === "research") {
		requireStatus(record, ["active", "done"], `Referenced ${record.kind}`);
	} else if (record.kind === "evidence") {
		requireStatus(record, ["recorded"], "Referenced evidence");
	}
}

function blockerIsNone(value: string): boolean {
	return /^none\.?$/i.test(value.trim());
}

function assertTaskShape(task: WorkRecord): AcceptanceCriterion[] {
	if (task.headers.parent) throw new WorkGraphError("Ledger tasks do not use Parent; keep plans inside the task or create a separate Depends-On task", "legacy_parent_header");
	for (const [header, canonical] of [["status", "Status"], ["created", "Created"], ["updated", "Updated"]] as const) {
		if (!task.headers[header]) throw new WorkGraphError(`Task is missing required header: ${header}`, "missing_task_header");
		if (!new RegExp(`^${canonical}:\\s`, "m").test(task.content)) throw new WorkGraphError(`Task header must use canonical spelling: ${canonical}`, "invalid_task_header");
	}
	for (const header of ["created", "updated"]) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(task.headers[header])) throw new WorkGraphError(`Task ${header} must use YYYY-MM-DD`, "invalid_task_header");
	}
	const titles = task.content.match(/^#\s+.+$/gm) ?? [];
	if (titles.length !== 1) throw new WorkGraphError("Task must contain exactly one level-one title", "invalid_task_title");
	for (const section of REQUIRED_TASK_SECTIONS) {
		if (!task.sections.has(section)) throw new WorkGraphError(`Task is missing required section: ${section}`, "missing_task_section");
	}
	if (!blockerIsNone(task.sections.get("blockers") ?? "")) throw new WorkGraphError("Task has unresolved blockers", "task_blocked");
	const document = task.taskDocument;
	if (!document) throw new WorkGraphError("Task did not load through the canonical task parser", "invalid_task_document");
	if (document.workItemIssues.length > 0) {
		throw new WorkGraphError(`Task has invalid Work Items: ${document.workItemIssues.map((issue) => `${issue.code} at line ${issue.line}`).join("; ")}`, "invalid_work_items");
	}
	if (document.criteria.length === 0) throw new WorkGraphError("Acceptance Criteria must contain stable IDs such as AC-001", "missing_criteria");
	return document.criteria;
}

function ledgerIndex(projectRoot: string): string {
	const normalized = normalizeProjectPath(projectRoot, LEDGER_INDEX_PATH);
	if (normalized !== LEDGER_INDEX_PATH) throw new WorkGraphError("Ledger index must be .ledger/README.md", "invalid_ledger_index");
	return readFileSync(resolve(projectRoot, normalized), "utf8");
}

function assertIndexed(index: string, taskPath: string): void {
	if (!recordPaths(index).includes(taskPath)) throw new WorkGraphError(`Ledger index does not list task: ${taskPath}`, "unindexed_task");
}

export function compileWorkGraph(projectRootInput: string, taskInput: string, limits: WorkGraphLimits = {}, ledgerRootInput = projectRootInput): CompiledWorkGraph {
	const projectRoot = realpathSync(projectRootInput);
	const ledgerRoot = realpathSync(ledgerRootInput);
	if (taskInput.includes(".10x/")) throw new WorkGraphError("Legacy .10x records are not executable; migrate the work into a .ledger task bundle", "legacy_10x_path");
	const taskPath = normalizeProjectPath(ledgerRoot, taskInput);
	const rootLocation = taskLocation(taskPath);
	if (!rootLocation) throw new WorkGraphError("Run root must be .ledger/<YYYYMMDDhhmm-slug>/task.md", "invalid_task_root");
	const index = ledgerIndex(ledgerRoot);
	assertIndexed(index, taskPath);
	const task = loadRecord(ledgerRoot, taskPath);
	requireStatus(task, ["open", "active"], "Root task");
	const criteria = assertTaskShape(task);

	const records = new Map<string, WorkRecord>([[task.path, task]]);
	const sourcePointers = new Set<string>();
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const maxRecords = limits.maxRecords ?? 64;
	const maxBytes = limits.maxBytes ?? 256 * 1024;

	const addRecord = (path: string): WorkRecord => {
		let record = records.get(path);
		if (!record) {
			record = loadRecord(ledgerRoot, path);
			records.set(path, record);
			if (records.size > maxRecords) throw new WorkGraphError(`Work graph exceeds ${maxRecords} records`, "graph_record_budget");
		}
		return record;
	};

	const visit = (record: WorkRecord, root: boolean): void => {
		if (visiting.has(record.path)) throw new WorkGraphError(`Record cycle detected at ${record.path}`, "record_cycle");
		if (visited.has(record.path)) return;
		visiting.add(record.path);
		const ownerBundle = bundleForRecord(record.path);
		if (!ownerBundle) throw new WorkGraphError(`Record has no task bundle: ${record.path}`, "invalid_task_record");

		const dependencies = splitHeaderPaths(record.headers["depends-on"]);
		if (record.kind !== "task" && dependencies.length > 0) throw new WorkGraphError(`Only task roots may declare Depends-On: ${record.path}`, "invalid_dependency_owner");
		const dependencyPaths: string[] = [];
		for (const raw of dependencies) {
			if (!raw.startsWith(".ledger/") || normalizeProjectPath(ledgerRoot, raw) !== raw) throw new WorkGraphError(`Dependency path must be canonical: ${raw}`, "path_escape");
			const location = taskLocation(raw);
			if (!location || location.bundlePath === ownerBundle) throw new WorkGraphError(`Dependency must name another task root: ${raw}`, "invalid_task_dependency");
			assertIndexed(index, raw);
			const dependency = addRecord(raw);
			requireStatus(dependency, ["done"], "Task dependency");
			dependencyPaths.push(raw);
			visit(dependency, false);
		}

		const text = referenceText(record, root);
		for (const source of sourcePaths(text)) sourcePointers.add(source);
		const references = recordPaths(text);
		for (const raw of references) {
			const normalized = normalizeProjectPath(ledgerRoot, raw);
			if (normalized !== raw) throw new WorkGraphError(`Ledger reference must be canonical: ${raw}`, "path_escape");
			if (bundleForRecord(normalized) !== ownerBundle) throw new WorkGraphError(`Task records may not reference another task bundle; use Depends-On: ${raw}`, "cross_task_reference");
			if (taskLocation(normalized)) throw new WorkGraphError(`Task roots may only be linked through Depends-On: ${raw}`, "invalid_task_reference");
			const child = addRecord(normalized);
			validateSupportingRecord(child);
			visit(child, false);
		}
		record.references = [...new Set([...dependencyPaths, ...references])].sort(byteSort);
		visiting.delete(record.path);
		visited.add(record.path);
	};
	visit(task, true);

	const ordered = [task, ...[...records.values()].filter((record) => record.path !== task.path).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || byteSort(a.path, b.path))];
	const bundleParts = ordered.map((record) => [
		`## Record: ${record.path}`,
		`Type: ${record.kind}`,
		`SHA-256: ${record.digest}`,
		"",
		record.content.trimEnd(),
	].join("\n"));
	if (sourcePointers.size > 0) bundleParts.push(`## Source pointers\n${[...sourcePointers].sort(byteSort).map((path) => `- ${path}`).join("\n")}`);
	const bundle = bundleParts.join("\n\n---\n\n") + "\n";
	const byteLength = Buffer.byteLength(bundle);
	if (byteLength > maxBytes) throw new WorkGraphError(`Compiled context is ${byteLength} bytes; limit is ${maxBytes}`, "graph_byte_budget");
	const graphHash = sha256(ordered.map((record) => `${record.path}\0${record.digest}`).join("\n"));
	return { projectRoot, ledgerRoot, task, records: ordered, criteria, sourcePointers: [...sourcePointers].sort(byteSort), graphHash, bundle, byteLength };
}

export function missingCriterionEvidence(graph: CompiledWorkGraph): string[] {
	const evidence = graph.task.sections.get("evidence") ?? "";
	const supported = new Set<string>();
	for (const line of evidence.split(/\r?\n/)) {
		const match = /^\s*[-*]\s*(AC-\d{3,})(?:\s*\[satisfied\])?\s*:\s*(.+?)\s*$/i.exec(line);
		if (!match) continue;
		const observation = match[2].trim();
		if (observation.length < 12 || /\b(?:pending|unknown|todo|tbd|not yet|will be|to be verified|not verified|not tested|not executed|did not run|was not run|no evidence|could not verify)\b/i.test(observation)) continue;
		supported.add(match[1].toUpperCase());
	}
	return graph.criteria.filter((criterion) => !supported.has(criterion.id)).map((criterion) => criterion.id);
}

function substantiveSection(value: string): boolean {
	const normalized = value.trim().split(/\r?\n/).map((line) => line
		.replace(/^\s*[-*]\s*/, "")
		.replace(/^(?:Iteration\s+\d+|\d{4}-\d{2}-\d{2}):\s*/i, "")
		.trim()).filter(Boolean);
	return normalized.join(" ").length >= 20
		&& normalized.every((line) => !/^(?:none|n\/a|todo|pending|tbd|not yet|will be|write\b.*\blater)\b/i.test(line));
}

export function hasRetrospective(graph: CompiledWorkGraph): boolean {
	return substantiveSection(graph.task.sections.get("retrospective") ?? "");
}

export function hasDistillation(graph: CompiledWorkGraph): boolean {
	return substantiveSection(graph.task.sections.get("distillation") ?? "");
}
