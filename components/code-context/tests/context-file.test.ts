import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { resolveContext } from "../src/context-file.js";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function project(contextFile: string | Buffer): string {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-code-context-"));
	directories.push(cwd);
	writeFileSync(join(cwd, "main.py"), "def create_app(): pass\n");
	mkdirSync(join(cwd, ".context"));
	writeFileSync(join(cwd, ".context", "main.py.md"), contextFile);
	return cwd;
}

function toolResult(toolName: string, text: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: "call",
		toolName,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: 0,
	};
}

describe("resolveContext", () => {
	it("hashes line endings and trailing whitespace away, from either the source or the context file path", () => {
		const unixCwd = project("## file\n\nKeep it.\n");
		const unix = resolveContext(join(unixCwd, "main.py"), unixCwd, []);
		const cwd = project("## file\r\n\r\nKeep it.  \r\n\r\n");
		const windows = resolveContext(join(cwd, ".context", "main.py.md"), cwd, []);

		expect(windows).toMatchObject({ status: "missing", displayPath: "main.py", content: "## file\n\nKeep it." });
		expect(windows?.marker).toMatch(/^<context-ref path="main\.py" hash="sha256:[0-9a-f]{64}" \/>$/);
		expect(windows?.marker).toBe(unix?.marker);
	});

	it("counts a marker as live only inside a read, edit, or write result", () => {
		const cwd = project("## file\n\nKeep it.\n");
		const marker = resolveContext(join(cwd, "main.py"), cwd, [])?.marker;
		const quoted: AgentMessage = { role: "user", content: `${marker}`, timestamp: 0 };

		expect(resolveContext(join(cwd, "main.py"), cwd, [quoted, toolResult("bash", `${marker}`)])?.status).toBe(
			"missing",
		);
		expect(resolveContext(join(cwd, "main.py"), cwd, [toolResult("read", `x\n${marker}`)])?.status).toBe("live");
	});

	it("reports files without a context file and context files that are not UTF-8", () => {
		const cwd = project(Buffer.from([0xff, 0xfe, 0x00]));
		expect(resolveContext(join(cwd, "other.py"), cwd, [])?.status).toBe("no_context_file");
		expect(resolveContext(join(cwd, "main.py"), cwd, [])).toMatchObject({
			status: "malformed",
			diagnostic: "it is not valid UTF-8",
		});
	});

	it("mirrors paths from the Git root under .context/, whatever the working directory", () => {
		const root = project("## file\n");
		mkdirSync(join(root, ".git"));
		mkdirSync(join(root, "app"));
		mkdirSync(join(root, ".context", "app"));
		writeFileSync(join(root, "app", "main.py"), "");
		writeFileSync(join(root, ".context", "app", "main.py.md"), "## file\n\nKeep it.\n");
		const cwd = join(root, "app");

		expect(resolveContext(join(cwd, "main.py"), cwd, [])).toMatchObject({
			status: "missing",
			isContextFile: false,
			displayPath: "main.py",
			contextFilePath: join(root, ".context", "app", "main.py.md"),
		});
		expect(resolveContext(join(root, ".context", "app", "main.py.md"), cwd, [])).toMatchObject({
			isContextFile: true,
			sourcePath: join(cwd, "main.py"),
		});
		expect(resolveContext(join(root, ".context", "notes.txt"), cwd, [])).toBeUndefined();
		expect(resolveContext(join(tmpdir(), "elsewhere.py"), cwd, [])).toBeUndefined();
	});
});
