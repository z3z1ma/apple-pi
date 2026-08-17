const READ_ONLY = ["read", "grep", "find", "ls"];

async function skillBody(name) {
	const text = await pi.read({ path: `skills/${name}/SKILL.md` });
	return text.replace(/^---[\s\S]*?---\n/, "").trim();
}

const files = (inputs.paths || "")
	.split("\n")
	.map((line) => line.trim())
	.filter(Boolean);
const background = (inputs.background || "").trim();
if (files.length === 0) throw new Error("inputs.paths is required (newline-separated files)");

const [plannerPrompt, reviewerPrompt, verifierPrompt] = await Promise.all([
	skillBody("review-planner"),
	skillBody("reviewer"),
	skillBody("review-verifier"),
]);

const plan = await agent({
	name: "planner",
	thinking: "low",
	tools: READ_ONLY,
	systemPrompt: plannerPrompt,
	task: "Partition the change into review focuses. Cover every listed file. Return through pi_exec_return.",
	context: { files, background },
	outputSchema: {
		type: "object",
		required: ["partitions"],
		properties: {
			partitions: {
				type: "array",
				items: {
					type: "object",
					required: ["files", "focuses"],
					properties: {
						title: { type: "string" },
						files: { type: "array", items: { type: "string" } },
						focuses: {
							type: "array",
							items: {
								type: "object",
								required: ["title", "question", "checks"],
								properties: {
									title: { type: "string" },
									question: { type: "string" },
									checks: { type: "array", items: { type: "string" } },
								},
							},
						},
					},
				},
			},
		},
	},
});

const focuses = [];
for (const [partitionIndex, partition] of plan.partitions.entries()) {
	for (const [focusIndex, focus] of partition.focuses.entries()) {
		focuses.push({
			id: `p${partitionIndex + 1}-f${focusIndex + 1}`,
			files: partition.files,
			...focus,
		});
	}
}

const reviews = await parallel(
	focuses,
	async (focus) => {
		const result = await agents.run({
			name: focus.id,
			thinking: "low",
			tools: READ_ONLY,
			systemPrompt: reviewerPrompt,
			task: `Falsify this focus. Return findings and notes through pi_exec_return.\n${focus.question}`,
			context: {
				id: focus.id,
				files: focus.files,
				question: focus.question,
				checks: focus.checks,
			},
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
		return {
			focus,
			status: result.status,
			reports: result.value?.reports ?? [],
			error: result.error,
		};
	},
	6,
);

const findings = [];
const notes = [];
for (const review of reviews) {
	for (const report of review.reports) {
		if (report.kind === "finding") findings.push({ ...report, focusId: review.focus.id });
		else notes.push({ ...report, focusId: review.focus.id });
	}
}

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
	focuses: focuses.length,
	findings: findings.length,
	failed: reviews.filter((review) => review.status !== "completed").map((review) => review.focus.id),
	meta,
};
