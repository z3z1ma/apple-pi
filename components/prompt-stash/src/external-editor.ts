import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ExternalEditorResult {
	status: "saved" | "aborted" | "error";
	content?: string;
	error?: string;
}

export interface ExternalEditorTui {
	stop?(): void;
	start?(): void;
	requestRender?(force?: boolean): void;
}

export interface ExternalEditorOptions {
	content: string;
	tui?: ExternalEditorTui;
	command?: string;
}

export function resolveEditorCommand(explicitCommand?: string): string {
	if (explicitCommand?.trim()) {
		return explicitCommand.trim();
	}
	return process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "vim");
}

export async function openInExternalEditor(options: ExternalEditorOptions): Promise<ExternalEditorResult> {
	const command = resolveEditorCommand(options.command);
	if (!command?.trim()) {
		return { status: "error", error: "No editor command found." };
	}

	const tempDir = mkdtempSync(join(tmpdir(), "pi-editor-"));
	const filePath = join(tempDir, "prompt.md");

	options.tui?.stop?.();
	process.stdout.write(`Launching external editor: ${command}\nPi will resume when the editor exits.\n`);

	try {
		writeFileSync(filePath, options.content, "utf-8");

		const exitCode = await new Promise<number | null>((resolve) => {
			let settled = false;
			const isWindows = process.platform === "win32";
			const child = isWindows
				? spawn(`${command} "${filePath}"`, {
						stdio: "inherit",
						shell: true,
					})
				: spawn("/bin/sh", ["-c", `${command} "$1"`, "sh", filePath], {
						stdio: "inherit",
					});

			child.on("error", () => {
				if (settled) return;
				settled = true;
				resolve(null);
			});

			child.on("close", (code) => {
				if (settled) return;
				settled = true;
				resolve(code);
			});
		});

		if (exitCode === null || exitCode === 127 || exitCode === 126) {
			return {
				status: "error",
				error: `Could not launch editor "${command}". Check your $EDITOR setting.`,
			};
		}

		if (exitCode !== 0) {
			return { status: "aborted" };
		}

		const rawContent = readFileSync(filePath, "utf-8");
		const cleanContent = rawContent.replace(/\r\n/g, "\n").replace(/\n$/, "");
		return {
			status: "saved",
			content: cleanContent,
		};
	} catch (err) {
		return {
			status: "error",
			error: err instanceof Error ? err.message : String(err),
		};
	} finally {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Best effort cleanup
		}
		options.tui?.start?.();
		options.tui?.requestRender?.(true);
	}
}
