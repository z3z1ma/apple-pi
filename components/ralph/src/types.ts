import type { AgentRecord } from "../../subagents/src/types.js";

export type RecordKind = "task" | "spec" | "plan" | "decision" | "research" | "evidence" | "knowledge" | "skill";

export interface WorkRecord {
	path: string;
	absolutePath: string;
	kind: RecordKind;
	status?: string;
	content: string;
	digest: string;
	headers: Record<string, string>;
	sections: Map<string, string>;
	references: string[];
}

export interface AcceptanceCriterion {
	id: string;
	text: string;
}

export interface CompiledWorkGraph {
	projectRoot: string;
	ledgerRoot: string;
	task: WorkRecord;
	records: WorkRecord[];
	criteria: AcceptanceCriterion[];
	sourcePointers: string[];
	graphHash: string;
	bundle: string;
	byteLength: number;
}

export interface WorkspaceEntry {
	path: string;
	kind: "file" | "symlink" | "directory";
	mode: number;
	size: number;
	digest: string;
}

export interface WorkspaceSnapshot {
	head: string;
	branch: string;
	indexHash: string;
	statusHash: string;
	entries: WorkspaceEntry[];
	hash: string;
}

export interface ChangedPath {
	path: string;
	change: "added" | "modified" | "deleted";
	before?: string;
	after?: string;
}

export type RalphRole = "executor" | "reviewer" | "judge";
export type RalphAgentRole = "executor" | "judge";
export type RalphMode = "step" | "auto";
export type RalphTerminalState =
	| "done"
	| "blocked"
	| "review_failed"
	| "evidence_failed"
	| "workspace_conflict"
	| "authority_required"
	| "budget_exhausted"
	| "compacted"
	| "interrupted"
	| "stopped"
	| "error";
export type RalphState =
	| "ready"
	| "executing"
	| "reviewing"
	| "judging"
	| "iterating"
	| RalphTerminalState;

export interface RalphBudgets {
	maxIterations: number;
	maxTokens: number;
	timeoutSeconds: number;
	executorMaxTurns: number;
	reviewerMaxTurns: number;
	judgeMaxTurns: number;
}

export interface RalphRun {
	schemaVersion: 2;
	runId: string;
	projectRoot: string;
	ledgerRoot: string;
	taskPath: string;
	mode: RalphMode;
	state: RalphState;
	iteration: number;
	budgets: RalphBudgets;
	startedAt: string;
	updatedAt: string;
	graphHash: string;
	baselineWorkspace: WorkspaceSnapshot;
	expectedWorkspace: WorkspaceSnapshot;
	totalTokens: number;
	activeAgentId?: string;
	lastOutcome?: string;
	nextObjective?: string;
}

export interface ReceiptEvent {
	schemaVersion: 2;
	sequence: number;
	timestamp: string;
	runId: string;
	projectRoot: string;
	ledgerRoot: string;
	taskPath: string;
	mode: RalphMode;
	state: RalphState;
	iteration: number;
	stage?: RalphRole;
	graphHash?: string;
	workspaceHashBefore?: string;
	workspaceHashAfter?: string;
	roleSkillHash?: string;
	agentId?: string;
	sessionFile?: string;
	usage?: { input: number; output: number; cacheWrite: number };
	compactions?: number;
	outcome?: string;
	structuredOutput?: unknown;
	gate?: { kind: RalphTerminalState; reason: string };
	run?: RalphRun;
}

export interface ExecutorOutput {
	status: "done" | "partial" | "blocked" | "failed";
	summary: string;
	acceptanceCriteria: { id: string; evidence: string; status: "satisfied" | "unsatisfied" | "unknown" }[];
	journal: string[];
	blockers: string[];
	retrospective: string;
	distillation: string[];
	nextObjective?: string;
}

export interface ReviewFinding {
	severity: "critical" | "significant" | "minor" | "nit";
	summary: string;
	evidence: string;
	path?: string;
}

export interface ReviewerOutput {
	verdict: "pass" | "concerns" | "fail";
	findings: ReviewFinding[];
	residualRisk: string[];
	summary: string;
}

export interface JudgeOutput {
	decision: "close" | "iterate" | "blocked" | "stop";
	reason: string;
	acceptanceCriteria: { id: string; status: "satisfied" | "unsatisfied" | "unknown"; evidence: string }[];
	nextObjective?: string;
}

export interface RoleRunResult<T> {
	record: AgentRecord;
	output: T;
}

export interface RunSummary {
	runId: string;
	state: RalphState;
	iteration: number;
	ledgerRoot: string;
	taskPath: string;
	lastOutcome?: string;
	nextObjective?: string;
	totalTokens: number;
	receiptPath: string;
}
