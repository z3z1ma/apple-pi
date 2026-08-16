import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../../subagents/src/types.js";
import type {
	CompiledWorkGraph,
	ExecutorOutput,
	JudgeOutput,
	ReviewerOutput,
	RalphAgentRole,
} from "./types.js";

const ROLE_FILES: Record<RalphAgentRole, string> = {
	executor: "../../../skills/ralph-executor/SKILL.md",
	judge: "../../../skills/ralph-judge/SKILL.md",
};

const ROLE_TOOLS: Record<RalphAgentRole, string[]> = {
	executor: ["read", "grep", "find", "ls", "bash", "edit", "write"],
	judge: ["read", "grep", "find", "ls"],
};

export interface RoleProfile {
	config: AgentConfig;
	skillHash: string;
}

function skillSource(role: RalphAgentRole): { body: string; hash: string } {
	const path = fileURLToPath(new URL(ROLE_FILES[role], import.meta.url));
	const raw = readFileSync(path, "utf8");
	const { body } = parseFrontmatter(raw);
	return { body: body.trim(), hash: createHash("sha256").update(raw).digest("hex") };
}

export function roleProfile(role: RalphAgentRole): RoleProfile {
	const skill = skillSource(role);
	return {
		skillHash: skill.hash,
		config: {
			name: `ralph-${role}`,
			displayName: `Ralph ${role[0].toUpperCase()}${role.slice(1)}`,
			description: `Fresh ${role} for a bounded Ralph iteration`,
			builtinToolNames: ROLE_TOOLS[role],
			extensions: false,
			skills: false,
			persistSession: true,
			systemPrompt: skill.body,
			promptMode: "replace",
			enabled: true,
		},
	};
}

function contextPacket(graph: CompiledWorkGraph): string {
	return [
		"<compiled-work-graph>",
		`Implementation workspace: ${graph.projectRoot}`,
		`Ledger authority root: ${graph.ledgerRoot}`,
		`Root task: ${graph.task.path}`,
		`Graph SHA-256: ${graph.graphHash}`,
		"",
		graph.bundle.trimEnd(),
		"</compiled-work-graph>",
	].join("\n");
}

export function executorPrompt(graph: CompiledWorkGraph, iteration: number, objective?: string): string {
	return [
		contextPacket(graph),
		"",
		"<iteration>",
		`Number: ${iteration}`,
		`Objective: ${objective?.trim() || "Advance the root task by the most important bounded in-scope increment."}`,
		"Start from the compiled graph, then inspect current source before editing.",
		"</iteration>",
	].join("\n");
}

export function judgePrompt(
	graph: CompiledWorkGraph,
	changes: string,
	executor: ExecutorOutput,
	review: ReviewerOutput,
): string {
	return [
		contextPacket(graph),
		"",
		"<executor-report>",
		JSON.stringify(executor, null, 2),
		"</executor-report>",
		"",
		"<independent-review>",
		JSON.stringify(review, null, 2),
		"</independent-review>",
		"",
		"<workspace-changes>",
		changes,
		"</workspace-changes>",
	].join("\n");
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
	return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
	return value.trim();
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
	if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`${label} must be one of ${allowed.join(", ")}`);
	return value as T;
}

function array(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value;
}

function parseJson(text: string, role: RalphAgentRole): Record<string, unknown> {
	const trimmed = text.trim();
	let value: unknown;
	try {
		value = JSON.parse(trimmed);
	} catch {
		throw new Error(`Ralph ${role} returned malformed JSON`);
	}
	return object(value, `Ralph ${role} output`);
}

function criterionRows(value: unknown): { id: string; status: "satisfied" | "unsatisfied" | "unknown"; evidence: string }[] {
	return array(value, "acceptanceCriteria").map((row, index) => {
		const item = object(row, `acceptanceCriteria[${index}]`);
		return {
			id: string(item.id, `acceptanceCriteria[${index}].id`),
			status: enumValue(item.status, ["satisfied", "unsatisfied", "unknown"] as const, `acceptanceCriteria[${index}].status`),
			evidence: string(item.evidence, `acceptanceCriteria[${index}].evidence`),
		};
	});
}

export function parseExecutorOutput(text: string): ExecutorOutput {
	const value = parseJson(text, "executor");
	const nextObjective = typeof value.nextObjective === "string" && value.nextObjective.trim() ? value.nextObjective.trim() : undefined;
	return {
		status: enumValue(value.status, ["done", "partial", "blocked", "failed"] as const, "status"),
		summary: string(value.summary, "summary"),
		acceptanceCriteria: criterionRows(value.acceptanceCriteria),
		journal: array(value.journal, "journal").map((item, index) => string(item, `journal[${index}]`)),
		blockers: array(value.blockers, "blockers").map((item, index) => string(item, `blockers[${index}]`)),
		retrospective: string(value.retrospective, "retrospective"),
		distillation: array(value.distillation, "distillation").map((item, index) => string(item, `distillation[${index}]`)),
		...(nextObjective && { nextObjective }),
	};
}

export function parseJudgeOutput(text: string): JudgeOutput {
	const value = parseJson(text, "judge");
	const decision = enumValue(value.decision, ["close", "iterate", "blocked", "stop"] as const, "decision");
	const nextObjective = typeof value.nextObjective === "string" && value.nextObjective.trim() ? value.nextObjective.trim() : undefined;
	if (decision === "iterate" && !nextObjective) throw new Error("Ralph judge must supply nextObjective for iterate");
	return {
		decision,
		reason: string(value.reason, "reason"),
		acceptanceCriteria: criterionRows(value.acceptanceCriteria),
		...(nextObjective && { nextObjective }),
	};
}
