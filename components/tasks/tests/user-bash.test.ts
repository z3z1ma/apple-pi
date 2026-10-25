import { stripVTControlCharacters } from "node:util";
import { BashExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, it } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { terminalShellOperations } from "../src/user-bash.js";

beforeAll(() => initTheme());

describe("operator shell display", () => {
	it.each([false, true])(
		"keeps PTY colors in the UI and plain text in the session (excluded: %s)",
		async (excludeFromContext) => {
			const fixture = await fauxSession([], [], []);
			const component = new BashExecutionComponent("test", { requestRender() {} } as any, excludeFromContext);
			try {
				const operations = terminalShellOperations({ mode: "tui" } as any);
				const result = await fixture.session.executeBash(
					"test -t 1 && printf '\\033[31mred\\033[0m\\n'; printf '10%%\\r100%%\\n'; printf '\\033[32mtail\\033[0m'",
					(chunk) => {
						component.appendOutput(chunk);
						if (chunk.includes("red")) expect(component.render(80).join("\n")).toContain("\x1b[31m");
					},
					{ operations, excludeFromContext },
				);
				component.setComplete(result.exitCode, result.cancelled);
				expect(result.output).toBe("red\n100%\ntail");
				expect(component.getOutput()).toBe(result.output);
				expect(JSON.stringify(fixture.session.messages)).not.toContain("\\u001b");
				await fixture.session.prompt("done");
				expect(JSON.stringify(fixture.requests)).not.toContain("\\u001b");
				expect(JSON.stringify(fixture.requests).includes("100%")).toBe(!excludeFromContext);
				for (const expanded of [false, true]) {
					component.setExpanded(expanded);
					component.invalidate();
					const rendered = component.render(80).join("\n");
					expect(rendered).toContain("\x1b[31m");
					expect(rendered).toContain("\x1b[32m");
					expect(rendered).toContain("100%");
				}
			} finally {
				component.setComplete(0, false);
				await fixture.dispose();
			}
		},
	);

	it("preserves Pi's visible output tail and keeps colors local to each command", async () => {
		const fixture = await fauxSession([], [], []);
		const component = new BashExecutionComponent("many lines", { requestRender() {} } as any);
		const ordinary = new BashExecutionComponent("many lines", { requestRender() {} } as any);
		try {
			const result = await fixture.session.executeBash(
				"for ((i=0; i<2100; i++)); do printf '\\033[31mline %s\\033[0m\\n' \"$i\"; done",
				(chunk) => component.appendOutput(chunk),
				{ operations: terminalShellOperations({ mode: "tui" } as any) },
			);
			component.setComplete(result.exitCode, result.cancelled);
			ordinary.appendOutput(component.getOutput());
			ordinary.setComplete(0, false);
			expect(ordinary.render(80).join("\n")).not.toContain("\x1b[31m");
			for (const expanded of [false, true]) {
				component.setExpanded(expanded);
				ordinary.setExpanded(expanded);
				const rendered = component.render(80).join("\n");
				expect(rendered).toContain("\x1b[31m");
				expect(stripVTControlCharacters(rendered)).toBe(stripVTControlCharacters(ordinary.render(80).join("\n")));
				expect(rendered).toContain("line 2099");
			}
			expect(result.output).not.toContain("\x1b");
		} finally {
			component.setComplete(0, false);
			ordinary.setComplete(0, false);
			await fixture.dispose();
		}
	});
});
