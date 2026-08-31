import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { homeSearchBlockReason, installHomeSearchGuard } from "../src/index.js";

const HOME = "/Users/example";
const BRACED_HOME = "$" + "{HOME}";

function harness() {
	let handler: ((event: any, ctx: ExtensionContext) => unknown) | undefined;
	const pi = {
		on(name: string, next: typeof handler) {
			if (name === "tool_call") handler = next;
		},
	};
	installHomeSearchGuard(pi as unknown as ExtensionAPI, HOME);
	if (!handler) throw new Error("Missing tool_call handler");
	return handler;
}

describe("home search guard", () => {
	it.each([
		["grep", { pattern: "needle", path: HOME }],
		["grep", { pattern: "needle", path: "~" }],
		["find", { pattern: "*.ts", path: "$HOME/" }],
		["glob", { pattern: "**/*.ts", root: BRACED_HOME }],
	])("blocks %s when its search root is home", (toolName, input) => {
		expect(homeSearchBlockReason(toolName, input, "/repo", HOME)).toMatch(/refusing to search.*home/i);
	});

	it("blocks an implicit tool root when the session itself is home", () => {
		expect(homeSearchBlockReason("grep", { pattern: "needle" }, HOME, HOME)).toBeDefined();
	});

	it.each([
		["grep", { pattern: "needle", path: `${HOME}/projects/apple-pi` }],
		["find", { pattern: "*.ts", path: "." }],
		["glob", { pattern: "**/*.ts", root: `${HOME}/projects` }],
	])("allows %s with a narrower root", (toolName, input) => {
		expect(homeSearchBlockReason(toolName, input, `${HOME}/projects/apple-pi`, HOME)).toBeUndefined();
	});

	it.each([
		"rg needle ~",
		"grep -R needle $HOME",
		`find "${BRACED_HOME}" -name '*.ts'`,
		"cd ~/ && rg needle",
		"sudo rg needle /Users/example/",
	])("blocks bash search commands rooted at home: %s", (command) => {
		expect(homeSearchBlockReason("bash", { command }, "/repo", HOME)).toBeDefined();
	});

	it("blocks an implicit bash search root when the session itself is home", () => {
		expect(homeSearchBlockReason("bash", { command: "rg needle" }, HOME, HOME)).toBeDefined();
	});

	it.each([
		"rg needle ~/projects/apple-pi",
		"grep -R needle .",
		"find /tmp -name '*.ts'",
		"echo rg $HOME",
		"git grep needle",
	])("allows bash commands that do not search from home: %s", (command) => {
		expect(homeSearchBlockReason("bash", { command }, "/repo", HOME)).toBeUndefined();
	});

	it("registers a blocking tool_call hook", () => {
		const result = harness()({ toolName: "grep", input: { pattern: "needle", path: HOME } }, {
			cwd: "/repo",
		} as ExtensionContext);
		expect(result).toEqual({
			block: true,
			reason: `Blocked grep: refusing to search from home directory ${HOME}. Use a narrower search root.`,
		});
	});
});
