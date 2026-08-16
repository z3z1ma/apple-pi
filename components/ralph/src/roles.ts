import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineTool, parseFrontmatter, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentConfig } from "../../subagents/src/types.js";
import type {
	CompiledWorkGraph,
	ExecutorOutput,
	JudgeOutput,
	ReviewerOutput,
	WorkItemCompletionProposal,
	WorkItemJudgment,
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

function object(value: unknown, label: string, keys?: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
	const record = value as Record<string, unknown>;
	if (keys && Object.keys(record).some((key) => !keys.includes(key)))
		throw new Error(`${label} contains unsupported fields`);
	return record;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
	return value.trim();
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
	if (typeof value !== "string" || !allowed.includes(value as T))
		throw new Error(`${label} must be one of ${allowed.join(", ")}`);
	return value as T;
}

function array(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value;
}

function criterionRows(
	value: unknown,
): { id: string; status: "satisfied" | "unsatisfied" | "unknown"; evidence: string }[] {
	return array(value, "acceptanceCriteria").map((row, index) => {
		const item = object(row, `acceptanceCriteria[${index}]`, ["id", "status", "evidence"]);
		return {
			id: string(item.id, `acceptanceCriteria[${index}].id`),
			status: enumValue(
				item.status,
				["satisfied", "unsatisfied", "unknown"] as const,
				`acceptanceCriteria[${index}].status`,
			),
			evidence: string(item.evidence, `acceptanceCriteria[${index}].evidence`),
		};
	});
}

function workItemCompletions(value: unknown): WorkItemCompletionProposal[] {
	return array(value, "workItemCompletions").map((row, index) => {
		const item = object(row, `workItemCompletions[${index}]`, ["id", "evidence"]);
		return {
			id: string(item.id, `workItemCompletions[${index}].id`),
			evidence: string(item.evidence, `workItemCompletions[${index}].evidence`),
		};
	});
}

function workItemJudgments(value: unknown): WorkItemJudgment[] {
	return array(value, "workItemJudgments").map((row, index) => {
		const item = object(row, `workItemJudgments[${index}]`, ["id", "decision", "reason"]);
		return {
			id: string(item.id, `workItemJudgments[${index}].id`),
			decision: enumValue(item.decision, ["confirmed", "rejected"] as const, `workItemJudgments[${index}].decision`),
			reason: string(item.reason, `workItemJudgments[${index}].reason`),
		};
	});
}

export function parseExecutorOutput(value: unknown): ExecutorOutput {
	const output = object(value, "Ralph executor result", [
		"status",
		"summary",
		"acceptanceCriteria",
		"journal",
		"blockers",
		"retrospective",
		"distillation",
		"workItemCompletions",
		"nextObjective",
	]);
	const nextObjective = output.nextObjective === undefined ? undefined : string(output.nextObjective, "nextObjective");
	return {
		status: enumValue(output.status, ["done", "partial", "blocked", "failed"] as const, "status"),
		summary: string(output.summary, "summary"),
		acceptanceCriteria: criterionRows(output.acceptanceCriteria),
		journal: array(output.journal, "journal").map((item, index) => string(item, `journal[${index}]`)),
		blockers: array(output.blockers, "blockers").map((item, index) => string(item, `blockers[${index}]`)),
		retrospective: string(output.retrospective, "retrospective"),
		distillation: array(output.distillation, "distillation").map((item, index) =>
			string(item, `distillation[${index}]`),
		),
		workItemCompletions: workItemCompletions(output.workItemCompletions),
		...(nextObjective && { nextObjective }),
	};
}

export function parseJudgeOutput(value: unknown): JudgeOutput {
	const output = object(value, "Ralph judge result", [
		"decision",
		"reason",
		"acceptanceCriteria",
		"workItemJudgments",
		"nextObjective",
	]);
	const decision = enumValue(output.decision, ["close", "iterate", "blocked", "stop"] as const, "decision");
	const nextObjective = output.nextObjective === undefined ? undefined : string(output.nextObjective, "nextObjective");
	if (decision === "iterate" && !nextObjective) throw new Error("Ralph judge must supply nextObjective for iterate");
	return {
		decision,
		reason: string(output.reason, "reason"),
		acceptanceCriteria: criterionRows(output.acceptanceCriteria),
		workItemJudgments: workItemJudgments(output.workItemJudgments),
		...(nextObjective && { nextObjective }),
	};
}

export interface RalphResultCapture {
	tool: ToolDefinition;
	calls(): number;
	value(): unknown;
}

function resultTool(name: string, label: string, parameters: ToolDefinition["parameters"]): RalphResultCapture {
	let count = 0;
	let submitted: unknown;
	return {
		tool: defineTool({
			name,
			label,
			description: `Submit the typed Ralph ${label.toLowerCase()}.`,
			parameters,
			executionMode: "sequential",
			async execute(_id, params) {
				count++;
				submitted = params;
				return { content: [{ type: "text", text: `${label} submitted.` }], details: params, terminate: true };
			},
		}),
		calls: () => count,
		value: () => submitted,
	};
}

export function createRalphResultTool(role: RalphAgentRole): RalphResultCapture {
	const strict = { additionalProperties: false };
	const criterion = Type.Object(
		{
			id: Type.String(),
			status: Type.Union([Type.Literal("satisfied"), Type.Literal("unsatisfied"), Type.Literal("unknown")]),
			evidence: Type.String(),
		},
		strict,
	);
	const completion = Type.Object({ id: Type.String(), evidence: Type.String() }, strict);
	const judgment = Type.Object(
		{
			id: Type.String(),
			decision: Type.Union([Type.Literal("confirmed"), Type.Literal("rejected")]),
			reason: Type.String(),
		},
		strict,
	);
	if (role === "executor")
		return resultTool(
			"submit_ralph_executor",
			"Executor result",
			Type.Object(
				{
					status: Type.Union([
						Type.Literal("done"),
						Type.Literal("partial"),
						Type.Literal("blocked"),
						Type.Literal("failed"),
					]),
					summary: Type.String(),
					acceptanceCriteria: Type.Array(criterion),
					journal: Type.Array(Type.String()),
					blockers: Type.Array(Type.String()),
					retrospective: Type.String(),
					distillation: Type.Array(Type.String()),
					workItemCompletions: Type.Array(completion),
					nextObjective: Type.Optional(Type.String()),
				},
				strict,
			),
		);
	return resultTool(
		"submit_ralph_judgment",
		"Judge result",
		Type.Object(
			{
				decision: Type.Union([
					Type.Literal("close"),
					Type.Literal("iterate"),
					Type.Literal("blocked"),
					Type.Literal("stop"),
				]),
				reason: Type.String(),
				acceptanceCriteria: Type.Array(criterion),
				workItemJudgments: Type.Array(judgment),
				nextObjective: Type.Optional(Type.String()),
			},
			strict,
		),
	);
}
