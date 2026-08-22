import { randomUUID } from "node:crypto";
import { defineTool, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { AutoClear } from "./auto-clear.js";
import { DEFAULT_TODOS_CONFIG, loadTodosConfigLayers } from "./config.js";
import { TodoController } from "./controller.js";
import { TodoExecution } from "./execution.js";
import { getManagedSubagentService } from "../../subagents/src/service.js";
import { ReminderCadence, TODO_REMINDER_CUSTOM_TYPE } from "./reminder-cadence.js";
import { ProjectTodoRepository, SessionTodoRepository } from "./repository.js";
import { TODOS_STATE_ENTRY } from "./state.js";
import type { Todo, TodoInput, TodosConfig, TodoUpdate, TodoView } from "./types.js";
import { openSettingsMenu } from "./ui/settings-menu.js";
import { openTodoManagerModal, type TodoManagerAction } from "./ui/todo-manager.js";
import { TodoWidget } from "./ui/todo-widget.js";

function formatTodo(todo: TodoView | Todo): string {
	const blockers = todo.blockedBy.length ? `; blocked by #${todo.blockedBy.join(", #")}` : "";
	return `#${todo.id} [${todo.status}] ${todo.title}${blockers}`;
}
function formatTodoDetail(todo: TodoView): string {
	const lines = [formatTodo(todo), `Created: ${todo.createdAt}`, `Updated: ${todo.updatedAt}`];
	if (todo.description) lines.push(`Description: ${todo.description}`);
	if (todo.activeForm) lines.push(`Active form: ${todo.activeForm}`);
	if (todo.agentType) lines.push(`Agent type: ${todo.agentType}`);
	if (todo.agentProfile) lines.push(`Profile: ${todo.agentProfile}`);
	if (todo.execution?.agentId) lines.push(`Agent ID: ${todo.execution.agentId}`);
	if (todo.blocks.length) lines.push(`Blocks: #${todo.blocks.join(", #")}`);
	if (todo.result) lines.push(`Result: ${todo.result}`);
	if (todo.lastError) lines.push(`Last error: ${todo.lastError}`);
	return lines.join("\n");
}
function mapInput(params: Record<string, unknown>): TodoInput | TodoUpdate {
	return {
		...(params.title !== undefined ? { title: params.title as string } : {}),
		...(params.description !== undefined ? { description: params.description as string } : {}),
		...(params.active_form !== undefined ? { activeForm: params.active_form as string } : {}),
		...(params.blocked_by !== undefined ? { blockedBy: params.blocked_by as number[] } : {}),
		...(params.agent_type !== undefined ? { agentType: params.agent_type as string } : {}),
		...(params.profile !== undefined ? { agentProfile: params.profile as string } : {}),
	};
}
export async function promptTodoFields(
	ui: { editor(title: string, initial?: string): Promise<string | undefined> },
	current: Partial<TodoInput> = {},
): Promise<TodoInput | undefined> {
	const title = await ui.editor("Todo title", current.title ?? "");
	if (title === undefined) return undefined;
	const description = await ui.editor("Todo description", current.description ?? "");
	if (description === undefined) return undefined;
	const activeForm = await ui.editor("Active form (optional)", current.activeForm ?? "");
	if (activeForm === undefined) return undefined;
	const agentType = await ui.editor("Agent type (optional)", current.agentType ?? "");
	if (agentType === undefined) return undefined;
	const agentProfile = await ui.editor("Profile (optional)", current.agentProfile ?? "");
	if (agentProfile === undefined) return undefined;
	return { title, description, activeForm, agentType, agentProfile };
}

function publish(ui: { setStatus(key: string, text: string | undefined): void } | undefined, todos: TodoView[]): void {
	const count = todos.filter((todo) => todo.status !== "completed").length;
	ui?.setStatus("todos", count > 0 ? `todos ${count}` : undefined);
}

export function installTodos(pi: ExtensionAPI) {
	const processUuid = randomUUID();
	let generation = 0;
	let unavailable: string | undefined;
	let config: Required<TodosConfig> = { ...DEFAULT_TODOS_CONFIG };
	let globalConfig: Required<TodosConfig> = { ...DEFAULT_TODOS_CONFIG };
	let projectConfig: TodosConfig = {};
	let cwd = process.cwd();
	let trusted = false;
	let selectedStorage: "session" | "project" = "session";
	const cadence = new ReminderCadence();
	const autoClear = new AutoClear();
	const appendSnapshot = (state: ReturnType<SessionTodoRepository["read"]>) => {
		try {
			pi.appendEntry(TODOS_STATE_ENTRY, state);
		} catch (error) {
			unavailable = `Todo state is unavailable after snapshot failure: ${error instanceof Error ? error.message : String(error)}`;
			throw error;
		}
	};
	let repository: SessionTodoRepository | ProjectTodoRepository = new SessionTodoRepository(undefined, appendSnapshot);
	let controller = new TodoController(repository, processUuid, generation);
	let currentContext: any;
	let execution!: TodoExecution;
	const widget = new TodoWidget(() => controller.list(), config);
	const refresh = (ui?: any) => {
		widget.setUICtx(ui);
		if (unavailable) {
			widget.dispose();
			ui?.setStatus("todos", undefined);
			return;
		}
		widget.setConfig(config);
		const todos = controller.list();
		widget.update();
		publish(ui, todos);
		autoClear.observe(todos, config, selectedStorage === "session");
	};
	const selectRepository = (ctx: any) => {
		currentContext = ctx;
		cwd = ctx.cwd ?? process.cwd();
		trusted = ctx.isProjectTrusted?.() === true;
		const layers = loadTodosConfigLayers(cwd, trusted);
		config = layers.effective;
		globalConfig = { ...DEFAULT_TODOS_CONFIG, ...layers.global };
		projectConfig = { ...layers.project };
		selectedStorage = config.storage === "project" && trusted ? "project" : "session";
		generation++;
		controller.invalidate();
		repository =
			selectedStorage === "project"
				? new ProjectTodoRepository(cwd)
				: new SessionTodoRepository(undefined, appendSnapshot);
		controller = new TodoController(repository, processUuid, generation);
		execution = new TodoExecution(
			controller,
			() => currentContext,
			() => refresh(currentContext?.ui),
			() => config.autoCascade,
			() => getManagedSubagentService(pi.events),
			{
				onStart: (id) => widget.setActiveRun(id),
				onActivity: (id, activity) => widget.updateActivity(id, activity),
				onUsage: (id, usage) => widget.addTokenUsage(usage.input, usage.output, id),
				onFinish: (id) => widget.setActiveRun(id, false),
			},
		);
		cadence.reset();
		autoClear.reset();
		try {
			if (repository instanceof SessionTodoRepository) repository.restore(ctx.sessionManager.getBranch(), processUuid);
			else repository.read();
			unavailable = undefined;
		} catch (error) {
			unavailable = `Todo state is unavailable: ${error instanceof Error ? error.message : String(error)}`;
		}
		refresh(ctx.ui);
	};
	pi.on("session_start", (_event, ctx) => selectRepository(ctx));
	pi.on("session_before_fork", async () => execution?.abortLocal());
	pi.on("session_before_tree", async () => execution?.abortLocal());
	pi.on("session_tree", (_event, ctx) => selectRepository(ctx));
	pi.on("session_before_switch", async () => execution?.abortLocal());
	pi.on("session_shutdown", async () => {
		await execution?.abortLocal();
		cadence.reset();
		autoClear.reset();
		widget.dispose();
	});
	pi.on("turn_start", (_event, ctx) => {
		if (unavailable || selectedStorage !== "session") return;
		const due = autoClear.onTurnStart(config.autoClearCompleted);
		if (due.length > 0 && controller.clearCompleted(due) > 0) refresh(ctx.ui);
	});
	pi.on("turn_end", () => {
		if (unavailable) return;
		const todos = controller.list();
		cadence.onTurnEnd(todos.some((todo) => todo.status === "active"));
	});
	pi.on("agent_settled", () => autoClear.onRunEnded());
	pi.on("context", (event) => {
		if (
			unavailable ||
			event.messages.some(
				(message: any) => message.role === "custom" && message.customType === TODO_REMINDER_CUSTOM_TYPE,
			)
		)
			return;
		const text = cadence.consume(controller.list(), config.reminders ?? true);
		if (!text) return;
		return {
			messages: [
				...event.messages,
				{
					role: "custom" as const,
					customType: TODO_REMINDER_CUSTOM_TYPE,
					content: [{ type: "text" as const, text }],
					display: false,
					timestamp: Date.now(),
				},
			],
		};
	});

	const register = <T extends Record<string, unknown>>(
		name: string,
		description: string,
		parameters: ReturnType<typeof Type.Object>,
		execute: (params: T) => { text: string; details: unknown } | Promise<{ text: string; details: unknown }>,
	) => {
		pi.registerTool(
			defineTool({
				name,
				label: name.replace("_", " "),
				description,
				promptSnippet: description,
				promptGuidelines: [
					"To-dos are active execution checklists; backlog parks ideas and Ledger holds durable project intent and evidence.",
				],
				parameters,
				executionMode: "sequential",
				async execute(_id, params, _signal, _update, ctx) {
					try {
						if (unavailable) throw new Error(unavailable);
						const result = await execute(params as T);
						return {
							content: [{ type: "text" as const, text: result.text }],
							details: result.details,
						};
					} finally {
						// A call counts as activity even when validation rejects it.
						cadence.noteTodoTool();
						refresh(ctx?.ui);
					}
				},
			}),
		);
	};
	const common = {
		title: Type.Optional(Type.String({ maxLength: 160 })),
		description: Type.Optional(Type.String({ maxLength: 2_000 })),
		active_form: Type.Optional(Type.String({ maxLength: 160 })),
		blocked_by: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))),
		agent_type: Type.Optional(Type.String({ maxLength: 80 })),
		profile: Type.Optional(Type.String({ maxLength: 80 })),
	};
	register(
		"todo_create",
		"Create an active-execution todo.",
		Type.Object({
			...common,
			title: Type.String({ minLength: 1, maxLength: 160 }),
		}),
		(params) => {
			if (
				selectedStorage === "session" &&
				autoClear.shouldRetireCompletedBatch(controller.list(), config.autoClearCompleted)
			)
				controller.clearCompleted();
			const todo = controller.create(mapInput(params) as TodoInput);
			return {
				text: `Created ${formatTodo({ ...todo, blocked: false, blocks: [] })}`,
				details: todo,
			};
		},
	);
	register("todo_list", "List the current active-execution checklist.", Type.Object({}), () => {
		const todos = controller.list();
		return {
			text: todos.length ? todos.map(formatTodo).join("\n") : "No to-dos.",
			details: todos,
		};
	});
	register("todo_get", "Read one todo by stable ID.", Type.Object({ id: Type.Integer({ minimum: 1 }) }), (params) => {
		const todo = controller.get(params.id as number);
		if (!todo) throw new Error(`Todo #${params.id} not found`);
		return { text: formatTodoDetail(todo), details: todo };
	});
	register(
		"todo_update",
		"Update an un-managed todo.",
		Type.Object({
			id: Type.Integer({ minimum: 1 }),
			status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("active"), Type.Literal("completed")])),
			...common,
		}),
		(params) => {
			const todo = controller.update(params.id as number, {
				...mapInput(params),
				...(params.status ? { status: params.status as TodoUpdate["status"] } : {}),
			});
			return { text: `Updated ${formatTodo(todo)}`, details: todo };
		},
	);
	register("todo_delete", "Delete an un-managed todo.", Type.Object({ id: Type.Integer({ minimum: 1 }) }), (params) => {
		const deleted = controller.delete(params.id as number);
		return { text: `Deleted todo #${deleted.deleted}`, details: deleted };
	});
	register(
		"todo_execute",
		"Start one or more eligible agent-backed to-dos in the managed subagent queue.",
		Type.Object({
			ids: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }),
			context: Type.Optional(Type.String({ maxLength: 4_000 })),
		}),
		(params) => {
			const batch = execution.execute(params.ids as number[], params.context as string | undefined);
			const lines = [
				...(batch.started.length ? [`Started ${batch.started.map((todo) => `#${todo.id}`).join(", ")}.`] : []),
				...batch.errors.map(({ id, error }) => `Did not start #${id}: ${error}`),
			];
			return { text: lines.join("\n"), details: batch };
		},
	);
	register(
		"todo_output",
		"Show managed to-do execution status and stored output; set wait to await a locally-owned run.",
		Type.Object({
			id: Type.Integer({ minimum: 1 }),
			wait: Type.Optional(Type.Boolean()),
		}),
		async (params) => {
			const todo = params.wait
				? await execution.waitForOutput(params.id as number)
				: execution.output(params.id as number);
			return { text: formatTodoDetail(todo), details: todo };
		},
	);
	register(
		"todo_stop",
		"Stop a locally-owned managed to-do execution.",
		Type.Object({ id: Type.Integer({ minimum: 1 }) }),
		(params) => {
			if (!execution.stop(params.id as number)) throw new Error(`Todo #${params.id} could not be stopped`);
			return {
				text: `Stopping todo #${params.id}.`,
				details: execution.output(params.id as number),
			};
		},
	);

	async function manager(ctx: ExtensionCommandContext): Promise<void> {
		if (ctx.mode !== "tui") return void ctx.ui.notify("/todos requires interactive mode", "error");
		let selectedId: number | undefined;
		for (;;) {
			const action = await openTodoManagerModal(ctx.ui, () => controller.list(), selectedId, {
				isProjectStorage: selectedStorage === "project",
				canExecute: true,
			});
			if (!action || action.type === "close") return;
			selectedId = "id" in action ? action.id : selectedId;
			try {
				if (await applyManagerAction(action, ctx)) refresh(ctx.ui);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		}
	}
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this dispatcher keeps the complete interactive manager action contract in one lifecycle owner.
	async function applyManagerAction(action: TodoManagerAction, ctx: ExtensionCommandContext): Promise<boolean> {
		if (action.type === "create") {
			const fields = await promptTodoFields(ctx.ui);
			if (!fields) return false;
			if (
				selectedStorage === "session" &&
				autoClear.shouldRetireCompletedBatch(controller.list(), config.autoClearCompleted)
			)
				controller.clearCompleted();
			controller.create(fields);
			return true;
		}
		if (action.type === "edit" || action.type === "blockers") {
			const todo = controller.get(action.id);
			if (!todo) return false;
			if (action.type === "edit") {
				const fields = await promptTodoFields(ctx.ui, todo);
				if (!fields) return false;
				controller.update(todo.id, fields);
			} else {
				const value = await ctx.ui.editor("Blocker IDs (comma separated)", todo.blockedBy.join(", "));
				if (value === undefined) return false;
				const blockedBy = value.trim() ? value.split(",").map((id) => Number(id.trim())) : [];
				if (blockedBy.some((id) => !Number.isInteger(id) || id < 1))
					throw new Error("Blocker IDs must be positive integers");
				controller.update(todo.id, { blockedBy });
			}
			return true;
		}
		if (action.type === "start" || action.type === "reopen" || action.type === "complete") {
			controller.update(action.id, {
				status: action.type === "start" ? "active" : action.type === "reopen" ? "open" : "completed",
			});
			return true;
		}
		if (action.type === "delete") {
			const todo = controller.get(action.id);
			if (!todo || !(await ctx.ui.confirm("Delete todo?", `#${todo.id} ${todo.title}`))) return false;
			controller.delete(action.id);
			return true;
		}
		if (action.type === "clear_completed" || action.type === "clear_all") {
			if (
				!(await ctx.ui.confirm(
					"Clear todos?",
					action.type === "clear_all" ? "Remove all todos?" : "Remove completed todos?",
				))
			)
				return false;
			action.type === "clear_all" ? controller.clearAll() : controller.clearCompleted();
			return true;
		}
		if (action.type === "settings") {
			if (!trusted) throw new Error("Todo settings require a trusted project");
			await openSettingsMenu(
				ctx.ui,
				config,
				projectConfig,
				globalConfig,
				cwd,
				trusted,
				async () => {},
				(error) =>
					ctx.ui.notify(
						`Could not save todo settings: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					),
			);
			widget.setConfig(config);
			return true;
		}
		if (action.type === "recover") {
			const todo = controller.get(action.id);
			if (
				!todo?.execution ||
				!(await ctx.ui.confirm("Recover stale execution?", `Confirm #${todo.id} is no longer running.`))
			)
				return false;
			if (!controller.recoverStaleProjectRun(todo.id, todo.execution.runId))
				throw new Error("Claim was retained: it changed, is live, or liveness could not be established");
			return true;
		}
		if (action.type === "execute") {
			const batch = execution.execute([action.id]);
			if (batch.errors.length) ctx.ui.notify(batch.errors.map(({ error }) => error).join("\n"), "error");
			return batch.started.length > 0;
		}
		if (action.type === "output") {
			const todo = execution.output(action.id);
			ctx.ui.notify(formatTodoDetail(todo), "info");
			return false;
		}
		if (action.type === "stop") {
			execution.stop(action.id);
			return true;
		}
		return false;
	}
	pi.registerCommand("todos", {
		description: "Manage the active execution checklist",
		handler: (_args, ctx) => manager(ctx),
	});
	return controller;
}
export default installTodos;
