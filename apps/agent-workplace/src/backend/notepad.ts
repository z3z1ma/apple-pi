import { type FSWatcher, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NotepadChange, NotepadRead, NotepadSave, WorldSnapshot } from "../world.js";

export const NOTEPAD_FILE = "NOTES.md";

export interface Notepads {
	open(coordinatorId: string): NotepadRead;
	save(coordinatorId: string, text: string, base: string): NotepadSave;
	close(): void;
}

const readText = (path: string) => {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
		throw error;
	}
};

export function openNotepads(snapshot: () => WorldSnapshot, onChange: (change: NotepadChange) => void): Notepads {
	let watcher: FSWatcher | undefined;
	let watched: { path: string; text: string } | undefined;

	const locate = (coordinatorId: string): { path: string } | { reason: string } => {
		const coordinator = snapshot().characters.find((c) => c.id === coordinatorId && c.role === "coordinator");
		const cwd = coordinator?.facts?.cwd;
		if (!cwd) return { reason: "That coordinator is not running." };
		try {
			if (!statSync(cwd).isDirectory()) return { reason: `${cwd} is not a directory.` };
		} catch {
			return { reason: `${cwd} does not exist.` };
		}
		return { path: join(cwd, NOTEPAD_FILE) };
	};

	const close = () => {
		watcher?.close();
		watcher = undefined;
		watched = undefined;
	};

	return {
		open(coordinatorId) {
			const at = locate(coordinatorId);
			if ("reason" in at) return { ok: false, reason: at.reason };
			close();
			let text: string;
			try {
				text = readText(at.path);
			} catch (error) {
				return { ok: false, reason: `The notes could not be read: ${(error as Error).message}` };
			}
			const file = { path: at.path, text };
			watched = file;
			watcher = watch(join(at.path, ".."), (_event, name) => {
				if (name !== NOTEPAD_FILE) return;
				let now: string;
				try {
					now = readText(file.path);
				} catch {
					return;
				}
				if (now === file.text) return;
				file.text = now;
				onChange({ coordinatorId, text: now });
			});
			return { ok: true, path: at.path, text };
		},

		save(coordinatorId, text, base) {
			const at = locate(coordinatorId);
			if ("reason" in at) return { ok: false, reason: at.reason };
			try {
				const current = readText(at.path);
				if (current !== base) return { ok: false, reason: "The notes changed on disk.", changed: current };
				writeFileSync(at.path, text);
				if (watched?.path === at.path) watched.text = text;
				return { ok: true };
			} catch (error) {
				return { ok: false, reason: `The notes could not be saved: ${(error as Error).message}` };
			}
		},

		close,
	};
}
