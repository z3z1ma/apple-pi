import { CustomMessageComponent, type ExtensionAPI, initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, expect, test } from "vitest";
import { installMail, MAIL_CUSTOM_TYPE, type Mail } from "../src/mail.js";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

function mailRenderer() {
	let renderer: ConstructorParameters<typeof CustomMessageComponent>[1];
	const pi = {
		on: () => {},
		registerTool: () => {},
		registerMessageRenderer: (_type: string, render: typeof renderer) => {
			renderer = render;
		},
	} as unknown as ExtensionAPI;
	installMail(pi);
	return renderer;
}

const mail: Mail = {
	id: "m-1",
	from: "floqast",
	fromName: "Nana Komatsu",
	subject: "Release check",
	ts: "2026-10-23T05:34:22.202Z",
	body: "The PR is green.\nNext, verify the dashboard against the canary before Friday and report what you could not check.",
};

const component = (expanded: boolean) => {
	const message = {
		role: "custom",
		customType: MAIL_CUSTOM_TYPE,
		content: "",
		display: true,
		details: mail,
		timestamp: 0,
	};
	const rendered = new CustomMessageComponent(message as never, mailRenderer());
	rendered.setExpanded(expanded);
	return rendered;
};

beforeAll(() => initTheme("dark"));

test("collapsed mail is one line in the stream: the label, sender and subject, and the start of the body", () => {
	const lines = component(false).render(60);
	expect(lines).toHaveLength(1);
	expect(visibleWidth(lines[0] ?? "")).toBeLessThanOrEqual(60);
	expect(strip(lines[0] ?? "")).toMatch(/^\u2709 Mail\(Nana Komatsu \u00b7 Release check: The PR is green\..*\.\.\.$/);
});

test("expanded mail shows the whole body under the label", () => {
	const lines = component(true).render(200).map(strip);
	expect(lines[0]).toBe("\u2709 Mail(Nana Komatsu \u00b7 Release check) 2026-10-23T05:34:22.202Z");
	expect(lines.slice(1)).toEqual([
		"  The PR is green.",
		"  Next, verify the dashboard against the canary before Friday and report what you could not check.",
	]);
});
