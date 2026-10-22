import { describe, expect, it } from "vitest";
import { buildInternCliArgs } from "../components/interns/src/runner.js";
import { loadSystemPrompt as loadPairSystemPrompt } from "../components/pair-programmer/src/config.js";
import { LEDGER_SYSTEM_PROMPT_TAG } from "../components/shared/src/ledger-system-prompt.js";
import { AUTO_COMPACT_EXTENSION_PATH } from "../extensions/auto-compact.js";
import { CODE_CONTEXT_EXTENSION_PATH } from "../extensions/code-context.js";
import { HOME_SEARCH_GUARD_EXTENSION_PATH } from "../extensions/home-search-guard.js";
import { LEDGER_EXTENSION_PATH } from "../extensions/ledger.js";
import { SESSION_SEARCH_EXTENSION_PATH } from "../extensions/session-search.js";
import { VROOM_EXTENSION_PATH } from "../extensions/vroom.js";
import { WIKI_EXTENSION_PATH } from "../extensions/wiki.js";

const marker = `<${LEDGER_SYSTEM_PROMPT_TAG}>`;
describe("ledger system prompt distribution", () => {
	it("loads the ledger extension on interns instead of pasting the contract", () => {
		const args = buildInternCliArgs("explore", "Inspect the task", {
			projectTrusted: false,
			model: "provider/model",
			thinking: "off",
		});
		const guidance = args[args.indexOf("--append-system-prompt") + 1];
		expect(guidance).not.toContain(marker);
		expect(args).toContain("--no-extensions");
		expect(args).toContain("--extension");
		expect(args.filter((_, index, all) => all[index - 1] === "--extension")).toEqual([
			AUTO_COMPACT_EXTENSION_PATH,
			VROOM_EXTENSION_PATH,
			HOME_SEARCH_GUARD_EXTENSION_PATH,
			LEDGER_EXTENSION_PATH,
			WIKI_EXTENSION_PATH,
			CODE_CONTEXT_EXTENSION_PATH,
			SESSION_SEARCH_EXTENSION_PATH,
		]);
	});

	it("does not copy the contract into the pair programmer prompt", () => {
		expect(loadPairSystemPrompt(process.cwd(), false)).not.toContain(marker);
	});
});
