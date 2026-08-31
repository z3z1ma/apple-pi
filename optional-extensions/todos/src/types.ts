export type TodoStatus = "open" | "active" | "completed";
export interface ExecutionClaim {
	runId: string;
	agentId?: string;
	ownerPid: number;
	ownerProcessUuid: string;
	claimedAt: string;
}
export interface Todo {
	id: number;
	title: string;
	description: string;
	activeForm?: string;
	status: TodoStatus;
	blockedBy: number[];
	createdAt: string;
	updatedAt: string;
	agentType?: string;
	agentProfile?: string;
	execution?: ExecutionClaim;
	result?: string;
	lastError?: string;
}
export interface TodoState {
	nextId: number;
	todos: Todo[];
}
export interface TodoInput {
	title: string;
	description?: string;
	activeForm?: string;
	blockedBy?: number[];
	agentType?: string;
	agentProfile?: string;
}
export interface TodoUpdate {
	title?: string;
	description?: string;
	activeForm?: string;
	status?: TodoStatus;
	blockedBy?: number[];
	agentType?: string;
	agentProfile?: string;
	result?: string;
	lastError?: string;
}
export interface TodoView extends Todo {
	blocked: boolean;
	blocks: number[];
}
export type TodoStorage = "session" | "project";
export interface TodosConfig {
	storage?: TodoStorage;
	autoCascade?: boolean;
	autoClearCompleted?: "never" | "on_list_complete" | "on_todo_complete";
	reminders?: boolean;
	sortOrder?: "id" | "active" | "recent";
	collapseCompleted?: boolean;
	maxVisible?: number;
}
