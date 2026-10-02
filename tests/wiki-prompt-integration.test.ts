import { describe, expect, it } from "vitest";
import { loadSystemPrompt as loadPairSystemPrompt } from "../components/pair-programmer/src/config.js";
import { WIKI_SYSTEM_PROMPT_TAG } from "../components/wiki/src/system-prompt.js";
import { childSessionExtensions } from "../components/subagents/src/agent-runner.js";
import { AUTO_COMPACT_EXTENSION_PATH } from "../extensions/auto-compact.js";
import { VROOM_EXTENSION_PATH } from "../extensions/vroom.js";
import { HOME_SEARCH_GUARD_EXTENSION_PATH } from "../extensions/home-search-guard.js";
import { LEDGER_EXTENSION_PATH } from "../extensions/ledger.js";
import { PAIR_EXTENSION_PATH } from "../extensions/pi-pair.js";
import { RTK_EXTENSION_PATH } from "../extensions/rtk.js";
import { buildAgentCliArgs } from "../extensions/runtime-agent.js";
import { SESSION_SEARCH_EXTENSION_PATH } from "../extensions/session-search.js";
import { WIKI_EXTENSION_PATH } from "../extensions/wiki.js";

const marker = `<${WIKI_SYSTEM_PROMPT_TAG}>`;
describe("wiki workbench distribution", () => {
	it("loads the wiki extension on workers instead of pasting the contract", () => {
		const args = buildAgentCliArgs(
			{ task: "Inspect the wiki", systemPrompt: "Custom worker guidance" },
			{ tools: ["read"], projectTrusted: false, model: "provider/model", thinking: "high" },
		);
		const guidance = args[args.indexOf("--append-system-prompt") + 1];
		expect(guidance).not.toContain(marker);
		expect(args[args.indexOf("--tools") + 1]).toBe("read,wiki_lint,wiki_references");
		expect(args.filter((_, index, all) => all[index - 1] === "--extension")).toEqual([
			AUTO_COMPACT_EXTENSION_PATH,
			VROOM_EXTENSION_PATH,
			HOME_SEARCH_GUARD_EXTENSION_PATH,
			LEDGER_EXTENSION_PATH,
			WIKI_EXTENSION_PATH,
			SESSION_SEARCH_EXTENSION_PATH,
		]);
	});

	it("does not copy the wiki contract into the pair programmer prompt", () => {
		expect(loadPairSystemPrompt(process.cwd(), false)).not.toContain(marker);
	});

	it("loads ordinary children with the wiki extension", () => {
		expect(childSessionExtensions()).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [
				AUTO_COMPACT_EXTENSION_PATH,
				VROOM_EXTENSION_PATH,
				HOME_SEARCH_GUARD_EXTENSION_PATH,
				LEDGER_EXTENSION_PATH,
				WIKI_EXTENSION_PATH,
				SESSION_SEARCH_EXTENSION_PATH,
				RTK_EXTENSION_PATH,
			],
		});
	});

	it("keeps the internal child free of wiki guidance and tools", () => {
		expect(childSessionExtensions(false, false)).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [AUTO_COMPACT_EXTENSION_PATH, VROOM_EXTENSION_PATH, HOME_SEARCH_GUARD_EXTENSION_PATH],
		});
	});

	it("adds the pair sidecar after the standard wiki boundary", () => {
		expect(childSessionExtensions(true)).toEqual({
			noExtensions: true,
			additionalExtensionPaths: [
				AUTO_COMPACT_EXTENSION_PATH,
				VROOM_EXTENSION_PATH,
				HOME_SEARCH_GUARD_EXTENSION_PATH,
				LEDGER_EXTENSION_PATH,
				WIKI_EXTENSION_PATH,
				SESSION_SEARCH_EXTENSION_PATH,
				RTK_EXTENSION_PATH,
				PAIR_EXTENSION_PATH,
			],
		});
	});
});
