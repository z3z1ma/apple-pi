import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendRtkSystemPrompt,
	isRtkAvailable,
	parseSemver,
	probeRtk,
	resetRtkCache,
	rewriteCommand,
	RTK_SYSTEM_PROMPT_SECTION,
} from "../src/index.js";
import { formatCollapsedLine, formatStatusBullet, stripAnsi } from "../../terse-tools/src/formatters.js";
import { createBashToolDefinition } from "../../tasks/src/bash-tool.js";

const mockTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	inverse: (text: string) => text,
	strikethrough: (text: string) => text,
} as any;

describe("RTK semver parsing", () => {
	it("parses valid semver strings", () => {
		expect(parseSemver("0.49.0")).toEqual([0, 49, 0]);
		expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
		expect(parseSemver("rtk 0.23.0\n")).toEqual([0, 23, 0]);
	});

	it("returns null on invalid semver strings", () => {
		expect(parseSemver("")).toBeNull();
		expect(parseSemver("unknown-version")).toBeNull();
		expect(parseSemver("v1")).toBeNull();
	});
});

describe("RTK detector", () => {
	const originalEnv = process.env.RTK_DISABLED;

	beforeEach(() => {
		resetRtkCache();
		delete process.env.RTK_DISABLED;
	});

	afterEach(() => {
		resetRtkCache();
		if (originalEnv !== undefined) {
			process.env.RTK_DISABLED = originalEnv;
		} else {
			delete process.env.RTK_DISABLED;
		}
	});

	it("detects RTK when installed on the host", async () => {
		const status = await probeRtk();
		expect(status.available).toBe(true);
		expect(status.version).toBeDefined();

		const available = await isRtkAvailable();
		expect(available).toBe(true);
	});

	it("disables RTK when RTK_DISABLED is set to 1", async () => {
		process.env.RTK_DISABLED = "1";
		const status = await probeRtk();
		expect(status.available).toBe(false);
	});

	it("caches probe result until resetRtkCache is called", async () => {
		const first = await probeRtk();
		process.env.RTK_DISABLED = "1";
		// Cached result should still return available
		const second = await probeRtk();
		expect(second).toBe(first);

		resetRtkCache();
		// Now it should re-probe and see RTK_DISABLED=1
		const third = await probeRtk();
		expect(third.available).toBe(false);
	});
});

describe("RTK rewriteCommand", () => {
	beforeEach(() => {
		resetRtkCache();
		delete process.env.RTK_DISABLED;
	});

	it("ignores empty, whitespace, or invalid commands", async () => {
		expect(await rewriteCommand("")).toBeNull();
		expect(await rewriteCommand("   ")).toBeNull();
		expect(await rewriteCommand(null as any)).toBeNull();
	});

	it("ignores commands already prefixed with rtk", async () => {
		expect(await rewriteCommand("rtk git status")).toBeNull();
		expect(await rewriteCommand("rtk vitest run")).toBeNull();
	});

	it("returns null when RTK_DISABLED is set", async () => {
		process.env.RTK_DISABLED = "1";
		expect(await rewriteCommand("git status")).toBeNull();
	});

	it("rewrites standard commands supported by RTK", async () => {
		const rewritten = await rewriteCommand("git status");
		expect(rewritten).toBe("rtk git status");
	});

	it("returns null for commands without an RTK equivalent", async () => {
		const rewritten = await rewriteCommand("echo hello world");
		expect(rewritten).toBeNull();
	});
});

describe("RTK system prompt injection", () => {
	it("returns the RTK section when base prompt is empty", () => {
		const result = appendRtkSystemPrompt("");
		expect(result).toBe(RTK_SYSTEM_PROMPT_SECTION);
		expect(result).toContain("Shell Optimization (RTK)");
		expect(result).toContain("verbatim: true");
	});

	it("appends the RTK section to an existing system prompt", () => {
		const base = "You are an assistant.";
		const result = appendRtkSystemPrompt(base);
		expect(result).toContain(base);
		expect(result).toContain(RTK_SYSTEM_PROMPT_SECTION);
	});

	it("is idempotent when the RTK section is already present", () => {
		const once = appendRtkSystemPrompt("You are an assistant.");
		const twice = appendRtkSystemPrompt(once);
		expect(twice).toBe(once);
	});
});

describe("Bash tool verbatim parameter", () => {
	it("includes verbatim in bash tool schema parameters", () => {
		const bashDef = createBashToolDefinition();
		expect(bashDef.parameters.properties).toHaveProperty("verbatim");
		expect(bashDef.promptGuidelines?.some((g) => g.includes("verbatim: true"))).toBe(true);
	});

	it("bypasses RTK rewriting when verbatim is true", async () => {
		const bashDef = createBashToolDefinition();
		const result = await bashDef.execute(
			"call-1",
			{
				command: "git status",
				verbatim: true,
			},
			undefined,
			undefined,
			{} as any,
		);
		expect(result.details?.rtk).toBe(false);
	});

	it("uses RTK rewriting when verbatim is omitted or false", async () => {
		const bashDef = createBashToolDefinition();
		const result = await bashDef.execute(
			"call-2",
			{
				command: "git status",
			},
			undefined,
			undefined,
			{} as any,
		);
		expect(result.details?.rtk).toBe(true);
	});
});

describe("Terse tools RTK bullet rendering", () => {
	it("renders standard bullet ● when isRtk is false or omitted", () => {
		expect(formatStatusBullet("success", mockTheme, false)).toBe("●");
		expect(formatStatusBullet("running", mockTheme, false)).toBe("●");
		expect(formatStatusBullet("error", mockTheme, false)).toBe("●");
		expect(formatStatusBullet("success", mockTheme)).toBe("●");
	});

	it("renders triangle bullet ▲ when isRtk is true", () => {
		expect(formatStatusBullet("success", mockTheme, true)).toBe("▲");
		expect(formatStatusBullet("running", mockTheme, true)).toBe("▲");
		expect(formatStatusBullet("error", mockTheme, true)).toBe("▲");
	});

	it("renders ▲ in formatCollapsedLine when isRtk is true", () => {
		const lineStandard = formatCollapsedLine(
			"bash",
			{ command: "git status" },
			"success",
			true,
			mockTheme,
			undefined,
			undefined,
			false,
		);
		expect(lineStandard).toContain("●");
		expect(lineStandard).not.toContain("▲");

		const lineRtk = formatCollapsedLine(
			"bash",
			{ command: "git status" },
			"success",
			true,
			mockTheme,
			undefined,
			undefined,
			true,
		);
		expect(lineRtk).toContain("▲");
		expect(lineRtk).not.toContain("●");
		// Also verify command is clean (git status)
		expect(lineRtk).toContain("git status");
	});

	it("uses _rawCommand in formatCollapsedLine when command was rewritten", () => {
		const line = formatCollapsedLine(
			"bash",
			{ command: "rtk git status", _rawCommand: "git status" },
			"success",
			true,
			mockTheme,
			undefined,
			undefined,
			true,
		);
		expect(line).toContain("▲");
		expect(stripAnsi(line)).toContain("Bash(git status)");
		expect(line).not.toContain("rtk git status");
	});
});
