import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import {
	AssistantMessageComponent,
	CustomMessageComponent,
	type ExtensionAPI,
	initTheme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import registerChangeReflection from "../../change-reflection/src/index.js";
import { registerLearningCycle } from "../../notebook/src/hooks/learning-cycle.js";
import { installSelf } from "../../organization/src/self.js";
import { installTerseToolRenderer } from "../../terse-tools/src/patch.js";
import { registerForkedContinuation } from "../src/forked-continuation.js";

const strip = (text: string) =>
	text
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/\x1b\][^\x07]*\x07/g, "")
		.trimEnd();
const renderers = new Map<string, ConstructorParameters<typeof CustomMessageComponent>[1]>();

beforeAll(() => {
	initTheme("dark");
	installTerseToolRenderer();
	const pi = {
		on: () => {},
		registerTool: () => {},
		registerCommand: () => {},
		registerMessageRenderer: (type: string, renderer: ConstructorParameters<typeof CustomMessageComponent>[1]) => {
			renderers.set(type, renderer);
		},
	} as unknown as ExtensionAPI;
	registerChangeReflection(pi);
	registerLearningCycle(pi);
	installSelf(pi, { reflects: true });
});

function note(customType: string, content: string) {
	return new CustomMessageComponent(
		{ role: "custom", customType, content, display: true, timestamp: 0 },
		renderers.get(customType),
	);
}

function tool() {
	return new ToolExecutionComponent("bash", "call", { command: "git status" }, {}, undefined, {} as any, process.cwd());
}

describe.each([
	["change-reflection", "Review"],
	["notebook.learning-reflection", "Reflection"],
	["notebook.learning-distillation", "Distill"],
	["organization-self-reflection", "Self"],
])("%s result", (customType, label) => {
	it("sits between tool calls without surrounding blank lines", () => {
		const container = new Container();
		container.addChild(tool());
		container.addChild(note(customType, `${label}: Checked the result.\n\nFurther detail.`));
		container.addChild(tool());
		const lines = container.render(100).map(strip);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain("Bash(git status)");
		expect(lines[1]).toBe(`\u21b3 ${label}: Checked the result.`);
		expect(lines[2]).toContain("Bash(git status)");
	});

	it.each([false, true])("separates prose on both sides with a hidden tool-only message: %s", (hiddenToolCall) => {
		const container = new Container();
		container.addChild(new AssistantMessageComponent(fauxAssistantMessage("Before the notices."), false));
		if (hiddenToolCall)
			container.addChild(
				new AssistantMessageComponent(fauxAssistantMessage(fauxToolCall("bash", { command: "git status" })), false),
			);
		container.addChild(note(customType, `${label}: Checked the result.`));
		container.addChild(note(customType, `${label}: Nothing else changed.`));
		container.addChild(new AssistantMessageComponent(fauxAssistantMessage("After the notices."), false));
		const lines = container.render(100).map(strip);
		const before = lines.findIndex((line) => line.includes("Before the notices."));
		const first = lines.indexOf(`\u21b3 ${label}: Checked the result.`);
		const last = lines.indexOf(`\u21b3 ${label}: Nothing else changed.`);
		const after = lines.findIndex((line) => line.includes("After the notices."));
		expect(lines.slice(before + 1, first)).toEqual([""]);
		expect(last).toBe(first + 1);
		expect(lines.slice(last + 1, after)).toEqual([""]);
	});

	it("preserves an existing spacer after assistant prose without adding another", () => {
		const container = new Container();
		container.addChild(new AssistantMessageComponent(fauxAssistantMessage("Before the notice."), false));
		container.addChild(new Spacer(1));
		container.addChild(note(customType, `${label}: Checked the result.`));
		const lines = container.render(100).map(strip);
		const before = lines.findIndex((line) => line.includes("Before the notice."));
		const result = lines.indexOf(`\u21b3 ${label}: Checked the result.`);
		expect(lines.slice(before + 1, result)).toEqual([""]);
	});

	it("keeps consecutive results adjacent", () => {
		const first = note(customType, `${label}: Checked the result.\n\nFurther detail.`);
		const container = new Container();
		container.addChild(first);
		container.addChild(note(customType, `${label}: Nothing else changed.`));
		expect(container.render(80).map(strip)).toEqual([
			`\u21b3 ${label}: Checked the result.`,
			`\u21b3 ${label}: Nothing else changed.`,
		]);
	});

	it.each([false, true])(
		"follows live thinking visibility before the first prompt, tools expanded=%s",
		async (toolsExpanded) => {
			const run = await fauxSession(
				[
					(pi) => {
						registerForkedContinuation(pi, customType, label);
					},
				],
				[],
				[],
			);
			try {
				run.session.settingsManager.setHideThinkingBlock(true);
				const component = new CustomMessageComponent(
					{ role: "custom", customType, content: `${label}: Checked.\n\nFurther detail.`, display: true, timestamp: 0 },
					run.session.extensionRunner?.getMessageRenderer(customType),
				);
				component.setExpanded(toolsExpanded);
				expect(component.render(80).map(strip)).toEqual([`\u21b3 ${label}: Checked.`]);
				run.session.settingsManager.setHideThinkingBlock(false);
				expect(component.render(30).map(strip)).toContain("Further detail.");
				expect(component.render(30).every((line) => visibleWidth(line) <= 30)).toBe(true);
				component.setExpanded(!toolsExpanded);
				expect(component.render(80).map(strip)).toContain("Further detail.");
				run.session.settingsManager.setHideThinkingBlock(true);
				expect(component.render(80).map(strip)).toEqual([`\u21b3 ${label}: Checked.`]);
			} finally {
				await run.session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
				await run.dispose();
			}
		},
	);
});
