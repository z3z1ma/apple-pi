import { describe, expect, it } from "vitest";
import { sessionSearchTool } from "../../session-search/src/tool.js";
import { PI_EXEC_DESCRIPTION, PI_EXEC_PROMPT_GUIDELINES, piExecGuestApiContract } from "../src/guest-api.js";

describe("runtime capability guidance", () => {
	it("teaches evidence reduction, dependency ordering, and outcome checks", () => {
		const guidance = PI_EXEC_PROMPT_GUIDELINES.join("\n");
		expect(guidance).toContain("Use direct tools for a single operation");
		expect(guidance).toContain("Keep intermediate results inside the program");
		expect(guidance).toContain("preserves the evidence");
		expect(guidance).toContain("Check tool and peer outcomes");
		expect(guidance).toContain("Surface failures and missing evidence");
		expect(guidance).toContain("Their role owns their model and thinking");
		expect(guidance).toContain("They stay alive after the program");
		expect(guidance).toContain("cleans every remaining temporary peer");
		expect(guidance).toContain("Handles belong to one execution");
	});

	it("keeps invocation mechanics and helper discovery in the code contract", () => {
		const contract = piExecGuestApiContract();
		expect(contract).toContain("pass keyword arguments");
		expect(contract).toContain("await dependent steps in order");
		expect(contract).toContain("tools_describe");
		expect(contract).toContain("tools_search/tools_call");
		expect(contract).toContain("repo_change_neighborhood");
		expect(contract).toContain("dev_find_relevant_tests/dev_run_relevant_tests");
		expect(contract).toContain("agent_run returns a status record");
		expect(contract).toContain("keep their first type");
		expect(contract).toContain('bash, edit, and write return {"ok": bool, "output": str}');
		expect(PI_EXEC_DESCRIPTION).toContain("printed output is also captured");
	});

	it("distinguishes transcript recall from current files and known notebook sources", () => {
		const guidance = sessionSearchTool.promptGuidelines?.join("\n") ?? "";
		expect(guidance).toContain("current repository files");
		expect(guidance).toContain("revisit_note for a known notebook id");
		const queryDescription = sessionSearchTool.parameters.properties.query.description;
		expect(queryDescription).toContain("#N:path[:offset[:limit]|:full]");
		expect(queryDescription).toContain("call:<toolCallId>");
	});
});
