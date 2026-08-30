import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	HarnessBoundedActivity,
	ManagedBackgroundRun,
	ManagedSubagentService,
} from "../../subagents/src/service.js";
import type { TodoController } from "./controller.js";
import type { TodoView } from "./types.js";

const MAX_CONTEXT = 4_000;
const MAX_PREREQUISITE_RESULTS = 4;
const MAX_RESULT = 10_000;

function bounded(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

export function buildTodoPrompt(todo: TodoView, all: readonly TodoView[], additionalContext?: string): string {
	const prerequisites = todo.blockedBy
		.map((id) => all.find((candidate) => candidate.id === id))
		.filter((candidate): candidate is TodoView => !!candidate?.result)
		.slice(0, MAX_PREREQUISITE_RESULTS)
		.map((candidate) => `Prerequisite #${candidate.id} (${candidate.title}):\n${bounded(candidate.result!, 1_500)}`);
	return [
		"Execute this to-do autonomously. Report a concise final result with completed work, validation, and blockers.",
		`To-do #${todo.id}: ${todo.title}`,
		todo.description ? `Description:\n${todo.description}` : "",
		prerequisites.length ? `Completed prerequisite results:\n${prerequisites.join("\n\n")}` : "",
		additionalContext?.trim() ? `Additional context:\n${bounded(additionalContext.trim(), MAX_CONTEXT)}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
}

export interface TodoExecutionBatch {
	started: TodoView[];
	errors: { id: number; error: string }[];
}

export interface TodoExecutionObserver {
	onStart?(id: number): void;
	onActivity?(id: number, activity: HarnessBoundedActivity): void;
	onUsage?(id: number, usage: { input: number; output: number; cacheWrite: number }): void;
	onFinish?(id: number): void;
	onManagedCompletion?(): void;
}

export class TodoExecution {
	private readonly local = new Map<string, { run: ManagedBackgroundRun; id: number; generation: number }>();

	constructor(
		private readonly controller: TodoController,
		private readonly ctx: () => ExtensionContext | undefined,
		private readonly refresh: () => void,
		private readonly autoCascade: () => boolean,
		private readonly service: () => ManagedSubagentService | undefined,
		private readonly observer: TodoExecutionObserver = {},
	) {}

	execute(ids: readonly number[], additionalContext?: string): TodoExecutionBatch {
		const started: TodoView[] = [];
		const errors: { id: number; error: string }[] = [];
		for (const id of [...new Set(ids)]) {
			try {
				started.push(this.start(id, additionalContext));
			} catch (error) {
				errors.push({
					id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		return { started, errors };
	}

	private start(id: number, additionalContext?: string): TodoView {
		const todo = this.controller.get(id);
		if (!todo) throw new Error(`Todo #${id} not found`);
		if (!todo.agentType) throw new Error(`Todo #${id} has no agent type`);
		if (todo.blocked) throw new Error(`Todo #${id} has unresolved blockers`);
		const claim = this.controller.claimExecution(id);
		this.observer.onStart?.(id);
		let startedRun: ManagedBackgroundRun | undefined;
		try {
			const ctx = this.ctx();
			const service = ctx && this.service();
			if (!ctx || !service) throw new Error("Managed subagent service is unavailable");
			const run = service.startBackground(ctx, {
				type: todo.agentType,
				profile: todo.agentProfile,
				description: `Todo #${todo.id}: ${todo.title}`,
				prompt: buildTodoPrompt(todo, this.controller.list(), additionalContext),
				cwd: ctx.cwd,
				onActivity: (activity) => this.observer.onActivity?.(id, activity),
				onAssistantUsage: (usage) => this.observer.onUsage?.(id, usage),
			});
			startedRun = run;
			this.local.set(claim.runId, { run, id, generation: claim.generation });
			void run.completion.then((record) => this.onCompletion(id, claim.runId, claim.generation, record));
			this.controller.attachExecutionAgent(id, claim.runId, run.id);
			return this.controller.get(id)!;
		} catch (error) {
			const message = bounded(error instanceof Error ? error.message : String(error), 2_000);
			if (startedRun) startedRun.abort();
			else {
				this.controller.settle(id, claim.runId, claim.generation, undefined, message);
				this.observer.onFinish?.(id);
			}
			this.refresh();
			throw new Error(message);
		}
	}

	private onCompletion(
		id: number,
		runId: string,
		generation: number,
		record: { status: string; result?: string; error?: string },
	): void {
		this.local.delete(runId);
		this.observer.onFinish?.(id);
		const success = record.status === "completed" || record.status === "steered";
		const settled = this.controller.settle(
			id,
			runId,
			generation,
			success ? bounded(record.result ?? "", MAX_RESULT) : undefined,
			success ? undefined : bounded(record.error || `Agent ${record.status}`, 2_000),
		);
		if (!settled) return;
		this.observer.onManagedCompletion?.();
		this.refresh();
		if (success && this.autoCascade()) this.cascade(id);
	}

	private cascade(completedId: number): void {
		for (const todo of this.controller.list()) {
			if (
				todo.blockedBy.includes(completedId) &&
				todo.status === "open" &&
				!todo.blocked &&
				todo.agentType &&
				!todo.execution
			) {
				try {
					this.start(todo.id);
				} catch {
					// A concurrent shared claim or unavailable catalog leaves it open with a recorded launch error.
				}
			}
		}
	}

	output(id: number): TodoView {
		const todo = this.controller.get(id);
		if (!todo) throw new Error(`Todo #${id} not found`);
		return todo;
	}

	async waitForOutput(id: number): Promise<TodoView> {
		const todo = this.output(id);
		const run = todo.execution && this.local.get(todo.execution.runId);
		if (run) await run.run.completion;
		return this.output(id);
	}

	stop(id: number): boolean {
		const todo = this.controller.get(id);
		if (!todo?.execution) throw new Error(`Todo #${id} has no managed execution`);
		if (todo.execution.ownerProcessUuid !== this.controller.processUuid)
			throw new Error(`Todo #${id} is running in another process and cannot be stopped here`);
		const run = this.local.get(todo.execution.runId);
		if (!run)
			throw new Error(`Todo #${id} is not attached to this process; use confirmed stale recovery if appropriate`);
		return run.run.abort();
	}

	async abortLocal(): Promise<void> {
		const runs = [...this.local.values()];
		for (const local of runs) local.run.abort();
		await Promise.all(runs.map((local) => local.run.completion));
		this.refresh();
	}
}
