export interface TerminalSession {
	id: string;
	cwd: string;
	shell: string;
}

export type TerminalEvent =
	| { type: "data"; id: string; data: string }
	| { type: "exit"; id: string; exitCode: number; signal?: number };

export type TerminalReply<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; reason: string };
export interface TerminalCreate {
	id: string;
	cwd: string;
	cols: number;
	rows: number;
}
export interface TerminalWrite {
	id: string;
	data: string;
}
export interface TerminalResize {
	id: string;
	cols: number;
	rows: number;
}
export interface TerminalClose {
	id: string;
}

export interface TerminalApi {
	create(request: TerminalCreate): Promise<TerminalReply<{ session: TerminalSession }>>;
	write(request: TerminalWrite): Promise<TerminalReply>;
	resize(request: TerminalResize): Promise<TerminalReply>;
	close(request: TerminalClose): Promise<TerminalReply>;
	onEvent(listener: (event: TerminalEvent) => void): () => void;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function dimension(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0xffff;
}
export function isTerminalClose(value: unknown): value is TerminalClose {
	return record(value) && typeof value.id === "string" && value.id.trim().length > 0;
}
export function isTerminalCreate(value: unknown): value is TerminalCreate {
	return (
		record(value) &&
		isTerminalClose(value) &&
		typeof value.cwd === "string" &&
		dimension(value.cols) &&
		dimension(value.rows)
	);
}
export function isTerminalWrite(value: unknown): value is TerminalWrite {
	return record(value) && isTerminalClose(value) && typeof value.data === "string";
}
export function isTerminalResize(value: unknown): value is TerminalResize {
	return record(value) && isTerminalClose(value) && dimension(value.cols) && dimension(value.rows);
}
