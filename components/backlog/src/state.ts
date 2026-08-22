export const BACKLOG_STATE_ENTRY = "apple-pi.backlog-state";

export interface BacklogItem {
	id: number;
	title: string;
	description: string;
	createdAt: string;
}

export interface BacklogState {
	items: BacklogItem[];
	nextId: number;
}

export interface BacklogItemInput {
	title: string;
	description?: string;
}

export function createBacklogState(): BacklogState {
	return { items: [], nextId: 1 };
}

function normalizedTitle(value: string): string {
	const title = value.trim().replace(/[ \t]+/g, " ");
	if (!title) throw new Error("Backlog title is required");
	if (/\r|\n/.test(title)) throw new Error("Backlog title must be one line");
	if (title.length > 160) throw new Error("Backlog title must be at most 160 characters");
	return title;
}

function normalizedDescription(value: string | undefined): string {
	const description = value?.trim() ?? "";
	if (description.length > 2_000) throw new Error("Backlog description must be at most 2000 characters");
	return description;
}

function copyState(state: BacklogState, items = state.items): BacklogState {
	return { items: items.map((item) => ({ ...item })), nextId: state.nextId };
}

export function addBacklogItem(
	state: BacklogState,
	input: BacklogItemInput,
	now = new Date(),
): { state: BacklogState; item: BacklogItem } {
	const item: BacklogItem = {
		id: state.nextId,
		title: normalizedTitle(input.title),
		description: normalizedDescription(input.description),
		createdAt: now.toISOString(),
	};
	return {
		state: { items: [...state.items.map((current) => ({ ...current })), item], nextId: state.nextId + 1 },
		item,
	};
}

export function editBacklogItem(state: BacklogState, id: number, input: BacklogItemInput): BacklogState {
	let found = false;
	const items = state.items.map((item) => {
		if (item.id !== id) return { ...item };
		found = true;
		return {
			...item,
			title: normalizedTitle(input.title),
			description: normalizedDescription(input.description),
		};
	});
	if (!found) throw new Error(`Backlog item #${id} not found`);
	return { items, nextId: state.nextId };
}

export function deleteBacklogItem(state: BacklogState, id: number): BacklogState {
	if (!state.items.some((item) => item.id === id)) throw new Error(`Backlog item #${id} not found`);
	return copyState(
		state,
		state.items.filter((item) => item.id !== id),
	);
}

export function moveBacklogItem(state: BacklogState, id: number, direction: "up" | "down"): BacklogState {
	const index = state.items.findIndex((item) => item.id === id);
	if (index < 0) throw new Error(`Backlog item #${id} not found`);
	const target = direction === "up" ? index - 1 : index + 1;
	if (target < 0 || target >= state.items.length) return copyState(state);
	const items = state.items.map((item) => ({ ...item }));
	[items[index], items[target]] = [items[target], items[index]];
	return { items, nextId: state.nextId };
}

function isBacklogState(value: unknown): value is BacklogState {
	if (!value || typeof value !== "object") return false;
	const state = value as Partial<BacklogState>;
	if (!Number.isInteger(state.nextId) || (state.nextId ?? 0) < 1 || !Array.isArray(state.items)) return false;
	return state.items.every((item) => {
		if (!item || typeof item !== "object") return false;
		const candidate = item as Partial<BacklogItem>;
		return (
			Number.isInteger(candidate.id) &&
			(candidate.id ?? 0) > 0 &&
			typeof candidate.title === "string" &&
			typeof candidate.description === "string" &&
			typeof candidate.createdAt === "string"
		);
	});
}

export function restoreBacklogState(entries: readonly unknown[]): BacklogState {
	let state = createBacklogState();
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as { type?: string; customType?: string; data?: unknown };
		if (candidate.type !== "custom" || candidate.customType !== BACKLOG_STATE_ENTRY) continue;
		if (isBacklogState(candidate.data)) state = copyState(candidate.data);
	}
	return state;
}
