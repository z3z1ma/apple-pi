/** Live, metadata-only skill selection over synthetic cases. No tools, sessions or workplace writes. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const bundle = dirname(fileURLToPath(import.meta.url));
let root = bundle;
while (!existsSync(join(root, "package.json")) || !existsSync(join(root, "skills"))) {
	assert.notEqual(root, dirname(root), "Repository root not found");
	root = dirname(root);
}
const { loadSkills } = await import(
	pathToFileURL(join(root, "node_modules/@earendil-works/pi-coding-agent/dist/core/skills.js")).href
);
const scratch = mkdtempSync(join(tmpdir(), "process-selection-"));
const globalDir = join(homedir(), ".pi/agent");
const settings = JSON.parse(readFileSync(join(globalDir, "settings.json"), "utf8"));
const runtime = await ModelRuntime.create({
	authPath: join(globalDir, "auth.json"),
	modelsPath: join(globalDir, "models.json"),
	modelsStorePath: join(scratch, "models.json"),
});
const model = runtime.getModel(settings.defaultProvider, settings.defaultModel);
assert(model, "Configured default model is not available");
const loaded = loadSkills({ cwd: root, skillPaths: [join(root, "skills")], includeDefaults: false, agentDir: scratch });
assert.deepEqual(loaded.diagnostics, []);
const visible = loaded.skills.filter((skill) => !skill.disableModelInvocation);
const catalog = visible.map(({ name, description }) => ({ name, description }));
const cases = [
	[
		"peer-consultation",
		"I own this problem and am stuck after two attempts. Two colleagues may see a better next probe. I still own the choice; there is no consequential disputed commitment.",
	],
	[
		"decision-review",
		"Three teams disagree about two costly-to-reverse architecture options. We need an accountable choice after each owner challenges the alternatives.",
	],
	[
		"tiger-team",
		"The migration has repeatedly failed at the seams between teams. We need one bounded end-to-end delivery, not another set of independently finished tickets.",
	],
	[
		"handoff",
		"I am transferring operations to a successor tomorrow. They have received the documents but have never used the recovery path. We need to establish accepted ownership.",
	],
	[
		"incident-response",
		"Users are currently unable to pay. Two authorized responders are proposing conflicting changes while stakeholders request updates. Coordinate recovery.",
	],
	[
		"operating-review",
		"Several commitments keep stalling and decisions take too long. I want to find the actual organizational constraint before deciding whether to change anything.",
	],
	[
		"retrospective",
		"The launch is over. A surprising failure recurred and then passed on rerun. We need to reconcile what happened and choose useful improvements without inventing its cause.",
	],
	[
		"pre-mortem",
		"Before we commit this consequential plan, ask people to imagine concrete ways it could fail and agree risk decisions. We are not injecting a fault.",
	],
	[
		"prioritization",
		"Five worthwhile requests exceed our team's commitments. Decide which to accept, defer or stop and make the displaced work explicit.",
	],
	[
		"release-readiness",
		"The exact release artifact is built. Decide whether it may proceed based on rollback, support, user-path and compatibility evidence.",
	],
	[
		"discovery-workshop",
		"We disagree about whose problem this proposed feature would solve. Gather actual evidence and decide which problem or inquiry matters before designing it.",
	],
	[
		"onboarding",
		"A colleague is new to this subsystem. No ownership is changing. Help them gain enough working understanding to perform their already assigned responsibility.",
	],
	[
		"failure-exercise",
		"In an authorized disposable environment, inject the agreed dependency failure, observe response, and verify restoration against a healthy control.",
	],
	[
		"due-diligence",
		"Before adopting this vendor, establish the inherited obligations, security liabilities, continuing costs and exit options. The owner will decide later.",
	],
	[
		"experiment-cycle",
		"Two competing explanations support different investment choices. Design a discriminating test, observe it and decide whether to continue, change or stop.",
	],
	["none", "Ask the maintainer which command starts the local dev server. A single factual answer is enough."],
	[
		"code-review",
		"Review this branch for concrete implementation defects and regressions against its originating intent.",
	],
	[
		"diagnosing-bugs",
		"This unit test now fails reliably. Diagnose the shared cause and reproduce it. No active user harm or multi-team response is involved.",
	],
];
const report = {
	provider: model.provider,
	model: model.id,
	evidence: "Live model selection from actual packaged descriptions, synthetic cases, no skill bodies or tools",
	cases: [],
	cost: 0,
};
try {
	for (const [expected, request] of cases) {
		const message = await runtime.completeSimple(
			model,
			{
				systemPrompt: `Choose the single best initial skill for each request, or none when no skill is useful. Selection grants no new authority. Return JSON only: {"skill":"name or none","reason":"brief reason"}. Available skills:\n${JSON.stringify(catalog)}`,
				messages: [{ role: "user", content: request, timestamp: Date.now() }],
			},
			{ reasoning: "low" },
		);
		const text = message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		let answer;
		try {
			answer = JSON.parse(text);
		} catch {
			answer = { skill: null, reason: text, error: message.errorMessage ?? message.stopReason };
		}
		report.cases.push({ expected, request, answer, passed: answer.skill === expected });
		report.cost += message.usage?.cost?.total ?? 0;
		writeFileSync(join(bundle, "selection-results.json"), `${JSON.stringify(report, null, 2)}\n`);
		console.log(`${answer.skill === expected ? "PASS" : "FAIL"} ${expected} -> ${answer.skill}`);
	}
	process.exitCode = report.cases.every((row) => row.passed) ? 0 : 1;
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
