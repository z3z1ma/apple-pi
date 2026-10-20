// The headquarters' notepad: which coordinator's notes are open, and what the panel sends. The notes are `NOTES.md` in
// the coordinator's directory; asking an agent to add an update puts a marker line where the cursor is and mails the
// agent to replace it, and a selection goes to an agent as mail. `main.tsx` connects the backend API. Each change
// replaces the state object, as useSyncExternalStore needs.
import type { AgentWorldApi, Character } from "../../../src/world.js";
import { onePanel } from "../one-panel.js";

export type NotepadApi = Pick<AgentWorldApi, "openNotepad" | "saveNotepad" | "closeNotepad" | "onNotepad">;

export interface NotepadState {
	/** The coordinator whose notes are open. */
	open?: Pick<Character, "id" | "name">;
	/** Counts each opening, so opening again starts afresh. */
	opening: number;
	api?: NotepadApi;
}

let state: NotepadState = { opening: 0 };
const listeners = new Set<() => void>();
const update = (change: Partial<NotepadState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};

export const notepad = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	connect(api: NotepadApi) {
		update({ api });
	},
	open(coordinator: Pick<Character, "id" | "name">) {
		onePanel.opening("notepad");
		update({ open: { id: coordinator.id, name: coordinator.name }, opening: state.opening + 1 });
	},
	close() {
		if (!state.open) return;
		update({ open: undefined });
		void state.api?.closeNotepad();
	},
};

onePanel.closes("notepad", () => notepad.close());

/** The line an agent replaces with the update it was asked for. */
export const updateMarker = (id: string) => `<!-- update pending: ${id} -->`;

/** `text` with `marker` on a line of its own at `at` (a cursor position), and where the marker line starts. */
export function insertMarker(text: string, at: number, marker: string): string {
	const before = text.slice(0, at);
	const after = text.slice(at);
	const lead = before === "" || before.endsWith("\n") ? "" : "\n";
	const trail = after.startsWith("\n") || after === "" ? "" : "\n";
	return `${before}${lead}${marker}${trail}${after}`;
}

/** `text` without the marker's line, as it was before a request that was not sent. */
export const removeMarker = (text: string, marker: string) =>
	text.replace(`${marker}\n`, "").replace(`\n${marker}`, "").replace(marker, "");

export const updateRequest = (path: string, marker: string, request: string) =>
	`Please write an update into my notepad, ${path}.\nReplace the line \`${marker}\` with: ${request.trim()}\nEdit only that line and leave the rest of the file as it is; I may be typing in it.`;

export const selectionMessage = (path: string, selection: string, note: string) => {
	const quoted = selection
		.trimEnd()
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
	const lead = note.trim() ? `${note.trim()}\n\n` : "";
	return `${lead}From my notepad (${path}):\n\n${quoted}`;
};
