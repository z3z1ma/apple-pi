import { CustomMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, expect, test } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { installMail, MAIL_CUSTOM_TYPE, type Mail, mailText } from "../src/mail.js";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of cleanup.splice(0)) await dispose();
});

const mail: Mail = {
	id: "m-1",
	from: "floqast",
	fromName: "Nana Komatsu",
	subject: "Release check",
	ts: "2026-10-23T05:34:22.202Z",
	body: "The PR is green.\nNext, verify the dashboard against the canary before Friday and report what you could not check.",
};

async function fixture(hidden: boolean, toolsExpanded: boolean) {
	const run = await fauxSession([installMail], [], []);
	cleanup.push(async () => {
		await run.session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
		run.dispose();
	});
	run.session.settingsManager.setHideThinkingBlock(hidden);
	const renderer = run.session.extensionRunner?.getMessageRenderer(MAIL_CUSTOM_TYPE);
	expect(renderer).toBeDefined();
	const component = new CustomMessageComponent(
		{
			role: "custom",
			customType: MAIL_CUSTOM_TYPE,
			content: "",
			display: true,
			details: mail,
			timestamp: 0,
		},
		renderer,
	);
	component.setExpanded(toolsExpanded);
	return { component, run };
}

test("a notification envelope exposes its actual conversation kind and stable message reference", () => {
	const envelope = mailText({
		...mail,
		thread: 'topic-"quoted',
		subject: "Shared <context>",
		threadKind: "channel",
		reference: { thread: 'topic-"quoted', seq: 42, id: 'message-&"' },
	});
	expect(envelope).toContain('thread="topic-&quot;quoted"');
	expect(envelope).toContain('subject="Shared &lt;context>"');
	expect(envelope).toContain('kind="channel"');
	expect(envelope).toContain('seq="42"');
	expect(envelope).toContain('message="message-&amp;&quot;"');
	expect(envelope).toContain(`\n${mail.body}\n</mail>`);
});

test("legacy mail keeps unknown metadata unknown even when its title resembles a meeting", () => {
	const envelope = mailText({ ...mail, thread: "t-legacy", subject: "Meeting" });
	expect(envelope).not.toContain(' kind="');
	expect(envelope).not.toContain(' seq="');
	expect(envelope).not.toContain(' message="');
	expect(envelope).toContain('subject="Meeting"');
});

beforeAll(() => initTheme("dark"));

test.each([false, true])("hidden thinking keeps mail collapsed, tools expanded=%s", async (toolsExpanded) => {
	const { component } = await fixture(true, toolsExpanded);
	const lines = component.render(60);
	expect(lines).toHaveLength(1);
	expect(visibleWidth(lines[0] ?? "")).toBeLessThanOrEqual(60);
	expect(strip(lines[0] ?? "")).toMatch(/^\u2709 Mail\(Nana Komatsu \u00b7 Release check: The PR is green\..*\.\.\.$/);
});

test.each([false, true])(
	"visible thinking expands mail before the first prompt, tools expanded=%s",
	async (toolsExpanded) => {
		const { component } = await fixture(false, toolsExpanded);
		const lines = component.render(200).map(strip);
		expect(lines[0]).toBe("\u2709 Mail(Nana Komatsu \u00b7 Release check) 2026-10-23T05:34:22.202Z");
		expect(lines.slice(1)).toEqual([
			"  The PR is green.",
			"  Next, verify the dashboard against the canary before Friday and report what you could not check.",
		]);
	},
);

test("an existing mail follows thinking visibility independently of tool expansion", async () => {
	const { component, run } = await fixture(true, true);
	expect(component.render(200)).toHaveLength(1);
	run.session.settingsManager.setHideThinkingBlock(false);
	expect(component.render(200).map(strip).join("\n")).toContain("  The PR is green.\n  Next, verify");
	component.setExpanded(false);
	expect(component.render(200)).toHaveLength(3);
	run.session.settingsManager.setHideThinkingBlock(true);
	expect(component.render(200)).toHaveLength(1);
});
