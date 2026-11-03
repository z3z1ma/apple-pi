import { expect, test } from "vitest";
import { commandRuleFor, installActionRules } from "../src/index.js";

test("commands that hurt a shared checkout are named by their rule", () => {
	expect(commandRuleFor("sed -i '' 's/a/b/' file.ts")?.id).toBe("bsd-sed-in-place");
	expect(commandRuleFor("git rm old.ts")?.id).toBe("git-rm-mv");
	expect(commandRuleFor("pkill -f vitest")?.id).toBe("kill-by-pattern");
	expect(commandRuleFor("npm test")?.id).toBe("full-test-suite");
	expect(commandRuleFor("cd repo && npm run test")?.id).toBe("full-test-suite");
	expect(commandRuleFor("npx vitest run components/x.test.ts --maxWorkers=1")).toBeUndefined();
	expect(commandRuleFor("npm run test:sidebar")).toBeUndefined();
	expect(commandRuleFor("git status --short")).toBeUndefined();
});

type Handler = (event: any) => any;

function harness() {
	const handlers = new Map<string, Handler>();
	installActionRules({ on: (name: string, handler: Handler) => handlers.set(name, handler) } as never);
	const message = (calls: { id: string; name: string }[]) =>
		handlers.get("message_end")!({
			message: { role: "assistant", content: calls.map((call) => ({ type: "toolCall", ...call })) },
		});
	const bash = (id: string, command: string) =>
		handlers.get("tool_call")!({ toolName: "bash", toolCallId: id, input: { command } });
	return { message, bash };
}

test("a commit issued in the same message as an edit is refused; one in a later message runs", () => {
	const { message, bash } = harness();
	message([
		{ id: "e1", name: "edit" },
		{ id: "b1", name: "bash" },
	]);
	expect(bash("b1", "git add a.ts && git commit -m x")?.reason).toMatch(/commit-beside-edit/);
	message([{ id: "b2", name: "bash" }]);
	expect(bash("b2", "git add a.ts && git commit -m x")).toBeUndefined();
	message([
		{ id: "e3", name: "write" },
		{ id: "b3", name: "bash" },
	]);
	expect(bash("b3", "git status")).toBeUndefined();
	expect(bash("x", "git rm a.ts")?.block).toBe(true);
});
