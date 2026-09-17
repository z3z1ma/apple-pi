import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ExternalEditorTui, openInExternalEditor, resolveEditorCommand } from "../src/external-editor.js";

describe("external editor resolution", () => {
	const originalVisual = process.env.VISUAL;
	const originalEditor = process.env.EDITOR;

	beforeEach(() => {
		delete process.env.VISUAL;
		delete process.env.EDITOR;
	});

	afterEach(() => {
		if (originalVisual !== undefined) {
			process.env.VISUAL = originalVisual;
		} else {
			delete process.env.VISUAL;
		}
		if (originalEditor !== undefined) {
			process.env.EDITOR = originalEditor;
		} else {
			delete process.env.EDITOR;
		}
	});

	it("uses explicit command when provided", () => {
		expect(resolveEditorCommand("nano -w")).toBe("nano -w");
		expect(resolveEditorCommand("  code --wait  ")).toBe("code --wait");
	});

	it("prefers VISUAL over EDITOR", () => {
		process.env.VISUAL = "subl -w";
		process.env.EDITOR = "nano";
		expect(resolveEditorCommand()).toBe("subl -w");
	});

	it("falls back to EDITOR when VISUAL is absent", () => {
		process.env.EDITOR = "emacs";
		expect(resolveEditorCommand()).toBe("emacs");
	});

	it("falls back to platform default (vim / notepad) when env vars are unset", () => {
		const expected = process.platform === "win32" ? "notepad" : "vim";
		expect(resolveEditorCommand()).toBe(expected);
	});
});

describe("openInExternalEditor execution", () => {
	it("updates content and notifies TUI lifecycle on successful edit", async () => {
		let tuiStopped = false;
		let tuiStarted = false;
		let renderRequested = false;

		const mockTui: ExternalEditorTui = {
			stop: () => {
				tuiStopped = true;
			},
			start: () => {
				tuiStarted = true;
			},
			requestRender: (_force?: boolean) => {
				renderRequested = true;
			},
		};

		// Node inline script that reads the file and appends edited content
		const nodeEditor = `${process.execPath} -e "const fs = require('fs'); const file = process.argv[1]; const c = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, c + ' edited via vim\\n');"`;

		const result = await openInExternalEditor({
			content: "Initial prompt",
			command: nodeEditor,
			tui: mockTui,
		});

		expect(tuiStopped).toBe(true);
		expect(tuiStarted).toBe(true);
		expect(renderRequested).toBe(true);
		expect(result.status).toBe("saved");
		expect(result.content).toBe("Initial prompt edited via vim");
	});

	it("returns aborted status when editor exits with non-zero status", async () => {
		const mockTui: ExternalEditorTui = {
			stop: vi.fn(),
			start: vi.fn(),
			requestRender: vi.fn(),
		};

		const abortEditor = `${process.execPath} -e "process.exit(1)"`;

		const result = await openInExternalEditor({
			content: "Unchanged",
			command: abortEditor,
			tui: mockTui,
		});

		expect(mockTui.stop).toHaveBeenCalledTimes(1);
		expect(mockTui.start).toHaveBeenCalledTimes(1);
		expect(result.status).toBe("aborted");
		expect(result.content).toBeUndefined();
	});

	it("returns error status when editor command cannot be spawned", async () => {
		const mockTui: ExternalEditorTui = {
			stop: vi.fn(),
			start: vi.fn(),
			requestRender: vi.fn(),
		};

		const result = await openInExternalEditor({
			content: "Unchanged",
			command: "non_existent_binary_for_testing_12345",
			tui: mockTui,
		});

		expect(mockTui.stop).toHaveBeenCalledTimes(1);
		expect(mockTui.start).toHaveBeenCalledTimes(1);
		expect(result.status).toBe("error");
		expect(result.error).toContain("Could not launch editor");
	});
});
