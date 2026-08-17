const READ_ONLY = ["read", "grep", "find", "ls"];

async function skillBody(name) {
	const text = await pi.read({ path: `skills/${name}/SKILL.md` });
	return text.replace(/^---[\s\S]*?---\n/, "").trim();
}

const files = (inputs.paths || "")
	.split("\n")
	.map((line) => line.trim())
	.filter(Boolean);
const question = (inputs.question || "").trim();
const checks = (inputs.checks || "")
	.split("\n")
	.map((line) => line.trim())
	.filter(Boolean);
if (files.length === 0) throw new Error("inputs.paths is required");
if (!question) throw new Error("inputs.question is required");

const [reviewerPrompt, verifierPrompt] = await Promise.all([
	skillBody("reviewer"),
	skillBody("review-verifier"),
]);

const review = await agents.run({
	name: "focus",
	thinking: "low",
	tools: READ_ONLY,
	systemPrompt: reviewerPrompt,
	task: `Falsify this focus. Return findings and notes through pi_exec_return.\n${question}`,
	context: { files, question, checks },
	outputSchema: {
		type: "object",
		required: ["reports"],
		properties: {
			reports: {
				type: "array",
				items: {
					type: "object",
					required: ["kind", "what"],
					properties: {
						kind: { type: "string" },
						severity: { type: "string" },
						path: { type: "string" },
						startLine: { type: "integer" },
						endLine: { type: "integer" },
						what: { type: "string" },
						why: { type: "string" },
					},
				},
			},
		},
	},
});

const reports = review.value?.reports ?? [];
const findings = reports.filter((report) => report.kind === "finding");
const notes = reports.filter((report) => report.kind !== "finding");

const meta = await agent({
	name: "verifier",
	thinking: "xhigh",
	tools: READ_ONLY,
	systemPrompt: verifierPrompt,
	task: "Decide every finding and write the meta-review. Return through pi_exec_return.",
	context: { findings, notes },
	outputSchema: {
		type: "object",
		required: ["decisions", "sentiment", "residuals", "coverageGaps"],
		properties: {
			decisions: {
				type: "array",
				items: {
					type: "object",
					required: ["path", "what", "status", "reason"],
					properties: {
						path: { type: "string" },
						what: { type: "string" },
						status: { type: "string" },
						reason: { type: "string" },
					},
				},
			},
			sentiment: { type: "string" },
			compoundRisks: { type: "array", items: { type: "string" } },
			residuals: { type: "array", items: { type: "string" } },
			coverageGaps: { type: "array", items: { type: "string" } },
		},
	},
});

return {
	files: files.length,
	status: review.status,
	findings: findings.length,
	error: review.error,
	meta,
};
