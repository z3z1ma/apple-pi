// Dynamic review template: planner -> axis-labelled focus reviews -> optional partition reducers -> final axis reducers.
// Adapt and inline the referenced prompts before passing this body to pi_exec.
const READ_ONLY = ["read", "grep", "find", "ls"];
const PLANNER = "<inline adapted references/planner.md>";
const REVIEWER = "<inline adapted references/reviewer.md>";
const VERIFIER = "<inline adapted references/verifier.md>";
const AXES = ["standards", "intent"];

const files = (inputs.paths || "")
	.split("\n")
	.map((path) => path.trim())
	.filter(Boolean);
const standardsPaths = (inputs.standardsPaths || "")
	.split("\n")
	.map((path) => path.trim())
	.filter(Boolean);
const intentPaths = (inputs.intentPaths || "")
	.split("\n")
	.map((path) => path.trim())
	.filter(Boolean);
const expectedAxes = (inputs.axes || "")
	.split("\n")
	.map((axis) => axis.trim())
	.filter(Boolean);
const smellBaselinePath = (inputs.smellBaselinePath || "").trim();
const background = (inputs.background || "").trim();
const compare = (inputs.compare || "").trim();
if (files.length === 0 || !compare || expectedAxes.length === 0) {
	throw new Error("inputs.paths, inputs.compare, and inputs.axes are required");
}
if (compare !== "HEAD" && !/^[A-Za-z0-9._/@{}~^:+-]+\.\.\.HEAD$/.test(compare)) {
	throw new Error("inputs.compare must be HEAD for working-tree review or an explicit <fixed-point>...HEAD range");
}
if (expectedAxes.some((axis) => !AXES.includes(axis)) || new Set(expectedAxes).size !== expectedAxes.length) {
	throw new Error("inputs.axes must contain unique standards and/or intent lines");
}
if (expectedAxes.includes("standards") && !smellBaselinePath) {
	throw new Error("inputs.smellBaselinePath is required for a Standards review");
}

const findingSchema = std.schema({
	findings: [
		{
			axis: ["standards", "intent"],
			title: "string",
			severity: ["critical", "significant", "minor"],
			path: "string",
			startLine: "int?",
			endLine: "int?",
			contract: "string",
			trigger: "string",
			evidence: "string",
			impact: "string",
			recommendation: "string",
		},
	],
	notes: [{ topic: "string", observation: "string" }],
});
const decisionSchema = std.schema({
	decisions: [
		{
			candidateId: "string",
			axis: ["standards", "intent"],
			title: "string",
			path: "string",
			startLine: "int?",
			contract: "string",
			status: ["confirmed", "rejected", "unresolved", "duplicate"],
			priorDisposition: ["not-applicable", "addressed", "open", "rejected", "unresolved"],
			severity: ["critical", "significant", "minor"],
			scope: ["in-scope", "out-of-scope"],
			loadBearing: "boolean",
			duplicateOf: "string?",
			trigger: "string",
			evidence: "string",
			impact: "string",
			recommendation: "string",
			suggestedOwner: "string?",
			revisitCondition: "string?",
			reason: "string",
		},
	],
	summary: "string",
	compoundRisks: ["string"],
	residualRisks: ["string"],
	coverageGaps: ["string"],
});

function priorityFor(candidate) {
	if (candidate.severity === "critical") return 3;
	if (candidate.severity === "significant") return 2;
	return 1;
}

function candidateReceipt(candidate) {
	const { priority: _priority, ...receipt } = candidate;
	return receipt;
}

function validateDecisions(candidates, decisions) {
	const reconciliation = std.reconcile.byId(candidates, decisions, { id: "candidateId" });
	if (
		reconciliation.unknownIds.length > 0 ||
		reconciliation.missingIds.length > 0 ||
		reconciliation.duplicateIds.length > 0
	) {
		throw new Error("coverage failure: final decisions have unknown, missing, or duplicate candidate IDs");
	}

	const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
	const decisionById = new Map(decisions.map((decision) => [decision.candidateId, decision]));

	function terminalDecision(decision) {
		const seen = new Set();
		let current = decision;
		while (current.status === "duplicate") {
			if (!current.duplicateOf || seen.has(current.candidateId)) {
				throw new Error(`invalid duplicate chain for ${decision.candidateId}`);
			}
			seen.add(current.candidateId);
			const next = decisionById.get(current.duplicateOf);
			if (!next || next.axis !== decision.axis) {
				throw new Error(`cross-axis or missing duplicate target for ${decision.candidateId}`);
			}
			current = next;
		}
		if (!["confirmed", "rejected", "unresolved"].includes(current.status)) {
			throw new Error(`duplicate ${decision.candidateId} has no terminal decision`);
		}
		if (current.severity !== decision.severity) {
			throw new Error(`duplicate ${decision.candidateId} must preserve terminal severity`);
		}
		return current;
	}

	for (const decision of decisions) {
		const candidate = candidateById.get(decision.candidateId);
		if (
			!candidate ||
			decision.axis !== candidate.axis ||
			decision.scope !== candidate.scope ||
			decision.title !== candidate.title ||
			decision.path !== candidate.path ||
			decision.contract !== candidate.contract
		) {
			throw new Error(`decision ${decision.candidateId} changed immutable candidate fields`);
		}

		const effective = decision.status === "duplicate" ? terminalDecision(decision) : decision;
		const live = ["confirmed", "unresolved"].includes(effective.status);
		const material = ["critical", "significant"].includes(effective.severity);

		if (candidate.source === "fresh" && decision.priorDisposition !== "not-applicable") {
			throw new Error(`fresh decision ${decision.candidateId} needs not-applicable priorDisposition`);
		}
		if (decision.scope === "out-of-scope" && live && material) {
			if (!decision.suggestedOwner || !decision.revisitCondition) {
				throw new Error(`out-of-scope decision ${decision.candidateId} needs owner and revisit metadata`);
			}
		}
		if (decision.scope === "in-scope" && live && material && !decision.loadBearing) {
			throw new Error(`in-scope material decision ${decision.candidateId} must be load-bearing`);
		}
		for (const field of ["contract", "trigger", "evidence", "impact", "recommendation"]) {
			if (typeof decision[field] !== "string" || !decision[field].trim()) {
				throw new Error(`decision ${decision.candidateId} needs ${field}`);
			}
		}

		if (candidate.source === "prior") {
			if (effective.status === "confirmed" && decision.priorDisposition !== "open") {
				throw new Error(`confirmed prior ${decision.candidateId} must remain open`);
			}
			if (effective.status === "unresolved" && decision.priorDisposition !== "unresolved") {
				throw new Error(`unresolved prior ${decision.candidateId} needs unresolved disposition`);
			}
			if (effective.status === "rejected" && !["addressed", "rejected"].includes(decision.priorDisposition)) {
				throw new Error(`rejected prior ${decision.candidateId} needs addressed or rejected disposition`);
			}
		}
	}

	return reconciliation;
}

let priorFindings = [];
if ((inputs.priorFindings || "").trim()) {
	const parsed = JSON.parse(inputs.priorFindings);
	if (!Array.isArray(parsed)) throw new Error("inputs.priorFindings must be a JSON array");
	const required = [
		"candidateId",
		"axis",
		"title",
		"severity",
		"path",
		"scope",
		"contract",
		"trigger",
		"evidence",
		"impact",
		"recommendation",
	];
	priorFindings = parsed.map((finding) => ({
		...finding,
		source: "prior",
		focusId: "prior-findings",
		partitionId: "historical",
		currentlyChanged: files.includes(finding.path),
	}));
	for (const finding of priorFindings) {
		if (required.some((field) => typeof finding[field] !== "string" || !finding[field].trim())) {
			throw new Error(`each prior finding needs non-empty ${required.join(", ")}`);
		}
		if (!AXES.includes(finding.axis)) throw new Error(`invalid prior axis: ${finding.axis}`);
		if (!["critical", "significant", "minor"].includes(finding.severity)) {
			throw new Error(`invalid prior severity: ${finding.severity}`);
		}
		if (!["in-scope", "out-of-scope"].includes(finding.scope)) {
			throw new Error(`invalid prior scope: ${finding.scope}`);
		}
		if (typeof finding.loadBearing !== "boolean") {
			throw new Error(`prior ${finding.candidateId} needs boolean loadBearing`);
		}
		if (finding.scope === "out-of-scope" && (!finding.suggestedOwner || !finding.revisitCondition)) {
			throw new Error(`out-of-scope prior ${finding.candidateId} needs owner and revisit metadata`);
		}
		if (finding.path.startsWith("/") || finding.path.split("/").includes("..")) {
			throw new Error(`prior path must be repository-relative: ${finding.path}`);
		}
	}
	if (new Set(priorFindings.map((finding) => finding.candidateId)).size !== priorFindings.length) {
		throw new Error("inputs.priorFindings contains duplicate IDs");
	}
}

const boundaryChange = await std.git.change({ compare });
const change = await std.git.change({ compare, paths: files });
const boundaryPaths = [...new Set([...boundaryChange.changedFiles, ...boundaryChange.untrackedFiles])];
const scopedPaths = [...new Set([...change.changedFiles, ...change.untrackedFiles])];
if (boundaryPaths.length === 0) {
	throw new Error("coverage failure: the selected comparison is empty");
}
const pathScopeCoverage = std.coverage.compare(boundaryPaths, scopedPaths);
if (!pathScopeCoverage.complete) {
	throw new Error(`coverage failure: requested paths omit ${pathScopeCoverage.missing.join(", ")}`);
}
const commitList =
	compare === "HEAD"
		? []
		: (
				await pi.bash({
					command: `git log --oneline ${compare.slice(0, -7)}..HEAD`,
				})
			).output
				.trim()
				.split("\n")
				.filter(Boolean);
const planningContext = std.context.fit(
	{
		files,
		standardsPaths,
		intentPaths,
		smellBaselinePath,
		expectedAxes,
		background,
		compare,
		statusText: boundaryChange.statusText,
		stat: boundaryChange.stat,
		changedFiles: boundaryChange.changedFiles,
		nameStatus: boundaryChange.nameStatus,
		untrackedFiles: boundaryChange.untrackedFiles,
		commitList,
		pathScopeCoverage,
		priorFindings,
		changePatch: std.context.clippable(change.patch, {
			maxChars: 12000,
			strategy: "head-tail",
			marker: "\n\n[... planning patch clipped ...]\n\n",
		}),
	},
	{ flags: { planningPatchTruncated: "$.changePatch" } },
).value;

const plan = await agent({
	name: "review-planner",
	profile: "balanced",
	tools: READ_ONLY,
	systemPrompt: PLANNER,
	task: "Produce axis-labelled partitions and focused investigations.",
	context: planningContext,
	outputSchema: std.schema({
		summary: "string",
		partitions: {
			array: { minItems: 1 },
			items: [
				{
					title: "string",
					files: { array: { minItems: 1 }, items: ["string"] },
					contextFiles: ["string"],
					rationale: "string",
					focuses: {
						array: { minItems: 1 },
						items: [
							{
								axis: ["standards", "intent"],
								title: "string",
								priority: ["high", "medium", "low"],
								question: "string",
								checks: { array: { minItems: 1 }, items: ["string"] },
								rationale: "string",
							},
						],
					},
				},
			],
		},
	}),
});

const selectedPaths = new Set(files);
const partitions = plan.partitions.map((partition, index) => ({
	id: `partition-${index + 1}`,
	...partition,
}));
for (const partition of partitions) {
	const outsideScope = partition.files.filter((path) => !selectedPaths.has(path));
	if (outsideScope.length > 0) {
		throw new Error(`planner assigned unselected changed paths: ${outsideScope.join(", ")}`);
	}
}

const assignedPaths = [...new Set(partitions.flatMap((partition) => partition.files))];
const assignmentCoverage = std.coverage.compare(
	files.map((path) => ({ path })),
	assignedPaths.map((path) => ({ path })),
	{ id: "path" },
);
if (!assignmentCoverage.complete) {
	throw new Error(
		`coverage failure: planner omitted ${assignmentCoverage.missing.map((item) => item.path).join(", ")}`,
	);
}

const focuses = partitions.flatMap((partition) =>
	partition.focuses.map((focus, index) => ({
		id: `${partition.id}-focus-${index + 1}`,
		partitionId: partition.id,
		partitionTitle: partition.title,
		targetFiles: partition.files,
		contextFiles: partition.contextFiles,
		...focus,
	})),
);
const unexpectedAxes = [...new Set(focuses.map((focus) => focus.axis))].filter(
	(axis) => !expectedAxes.includes(axis),
);
if (unexpectedAxes.length > 0) {
	throw new Error(`planner produced unexpected axes: ${unexpectedAxes.join(", ")}`);
}
const axisAssignmentCoverage = expectedAxes.map((axis) => {
	const assigned = [
		...new Set(
			partitions
				.filter((partition) => partition.focuses.some((focus) => focus.axis === axis))
				.flatMap((partition) => partition.files),
		),
	];
	const coverage = std.coverage.compare(
		files.map((path) => ({ path })),
		assigned.map((path) => ({ path })),
		{ id: "path" },
	);
	if (!coverage.complete) {
		throw new Error(`coverage failure: ${axis} axis omitted ${coverage.missing.map((item) => item.path).join(", ")}`);
	}
	return { axis, ...coverage };
});

const reviews = await parallel(focuses, async (focus) => {
	try {
		const patch = await std.git.patch({ compare, paths: focus.targetFiles });
		const context = std.context.fit(
			{
				focus,
				standardsPaths,
				intentPaths,
				smellBaselinePath,
				expectedAxes,
				background,
				compare,
				untrackedFiles: change.untrackedFiles.filter((path) => focus.targetFiles.includes(path)),
				patch: std.context.clippable(patch, {
					maxChars: 16000,
					strategy: "head-tail",
					marker: "\n\n[... focus patch clipped ...]\n\n",
				}),
			},
			{ flags: { patchTruncated: "$.patch" } },
		).value;
		const result = await agent.run({
			name: focus.id,
			profile: "quick",
			tools: READ_ONLY,
			systemPrompt: REVIEWER,
			task: "Perform the assigned read-only, evidence-backed focus investigation.",
			context,
			outputSchema: findingSchema,
		});
		return {
			focus,
			status: result.status,
			findings: result.value?.findings ?? [],
			notes: result.value?.notes ?? [],
			patchTruncated: context.patchTruncated,
			error: result.error,
		};
	} catch (error) {
		return {
			focus,
			status: "failed",
			findings: [],
			notes: [],
			patchTruncated: false,
			error: String(error),
		};
	}
});

const candidates = priorFindings.map((finding) => ({ ...finding }));
const notes = [];
for (const review of reviews) {
	for (const [index, finding] of review.findings.entries()) {
		if (finding.axis !== review.focus.axis) {
			throw new Error(`axis mismatch in ${review.focus.id}`);
		}
		candidates.push({
			...finding,
			candidateId: `fresh-${review.focus.id}-${index + 1}`,
			source: "fresh",
			focusId: review.focus.id,
			partitionId: review.focus.partitionId,
			scope: review.focus.targetFiles.includes(finding.path) ? "in-scope" : "out-of-scope",
			loadBearing: false,
		});
	}
	for (const [index, note] of review.notes.entries()) {
		notes.push({ id: `${review.focus.id}-note-${index + 1}`, focusId: review.focus.id, ...note });
	}
}
if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) {
	throw new Error("candidate IDs must be unique");
}

const failedFocuses = reviews
	.filter((review) => review.status !== "completed")
	.map((review) => ({ id: review.focus.id, error: review.error || "worker failed" }));
const truncatedFocuses = reviews.filter((review) => review.patchTruncated).map((review) => review.focus.id);
const focusCoverage = reviews.map((review) => ({
	id: review.focus.id,
	axis: review.focus.axis,
	partitionId: review.focus.partitionId,
	targetFiles: review.focus.targetFiles,
	question: review.focus.question,
	status: review.status,
	patchTruncated: review.patchTruncated,
}));
const packedNotes = std.context.pack(notes, {
	id: "id",
	fields: { topic: 160, observation: 400 },
	maxSerializedChars: 8000,
});

async function reduceAxis(axis, axisCandidates) {
	const prepared = axisCandidates.map((candidate) => ({
		...candidate,
		priority: priorityFor(candidate),
	}));
	let packedCandidates = std.context.pack(prepared, {
		id: "candidateId",
		priority: "priority",
		maxSerializedChars: 12000,
	});
	let reductionEvidence = [];

	if (packedCandidates.omitted.length > 0) {
		const groups = new Map();
		for (const candidate of prepared) {
			const key = candidate.partitionId || "historical";
			groups.set(key, [...(groups.get(key) ?? []), candidate]);
		}
		reductionEvidence = await parallel([...groups.entries()], async ([groupId, group]) => {
			const batch = std.context.pack(group, {
				id: "candidateId",
				priority: "priority",
				maxSerializedChars: 12000,
			});
			if (batch.omitted.length > 0) {
				throw new Error(`coverage failure: semantic group ${groupId} omitted ${batch.omittedIds.join(", ")}`);
			}
			const verdict = await agent({
				name: `${axis}-${groupId}-reducer`,
				profile: "balanced",
				tools: READ_ONLY,
				systemPrompt: VERIFIER,
				task: "Independently inspect and decide this complete same-axis semantic group.",
				context: {
					axis,
					files,
					standardsPaths,
					intentPaths,
					smellBaselinePath,
					background,
					compare,
					patch: planningContext.changePatch,
					patchTruncated: planningContext.planningPatchTruncated,
					candidates: batch.items,
				},
				outputSchema: decisionSchema,
			});
			validateDecisions(group, verdict.decisions);
			return {
				groupId,
				candidateReceipts: group.map(candidateReceipt),
				...verdict,
			};
		});

		const packedReductions = std.context.pack(
			reductionEvidence.map((verdict) => ({ id: verdict.groupId, priority: 1, verdict })),
			{ id: "id", priority: "priority", maxSerializedChars: 24000 },
		);
		if (packedReductions.omitted.length > 0) {
			throw new Error(`coverage failure: final ${axis} reducer cannot receive complete reductions`);
		}
		packedCandidates = packedReductions;
	}

	const finalVerdict = await agent({
		name: `${axis}-final-verifier`,
		profile: "deep",
		tools: READ_ONLY,
		systemPrompt: VERIFIER,
		task: "Independently decide every original candidate in this axis exactly once and assess coverage.",
		context: {
			axis,
			files,
			standardsPaths,
			intentPaths,
			smellBaselinePath,
			expectedAxes,
			background,
			compare,
			patch: planningContext.changePatch,
			patchTruncated: planningContext.planningPatchTruncated,
			candidateIds: prepared.map((candidate) => candidate.candidateId),
			candidates: reductionEvidence.length > 0 ? [] : packedCandidates.items,
			reductionEvidence: reductionEvidence.length > 0 ? packedCandidates.items : [],
			focusCoverage: focusCoverage.filter((focus) => focus.axis === axis),
			notes: packedNotes.items.filter((note) =>
				focusCoverage.some((focus) => focus.axis === axis && focus.id === note.focusId),
			),
			noteIdsOmitted: packedNotes.omittedIds,
			failedFocuses: failedFocuses.filter((failure) =>
				focusCoverage.some((focus) => focus.axis === axis && focus.id === failure.id),
			),
			truncatedFocuses: truncatedFocuses.filter((id) =>
				focusCoverage.some((focus) => focus.axis === axis && focus.id === id),
			),
			planningPatchTruncated: planningContext.planningPatchTruncated,
		},
		outputSchema: decisionSchema,
	});
	const reconciliation = validateDecisions(axisCandidates, finalVerdict.decisions);
	return { axis, reconciliation, ...finalVerdict };
}

const activeAxes = expectedAxes;
const axisVerdicts = await Promise.all(
	activeAxes.map((axis) =>
		reduceAxis(
			axis,
			candidates.filter((candidate) => candidate.axis === axis),
		),
	),
);
const decisions = axisVerdicts.flatMap((verdict) => verdict.decisions);
const decisionReconciliation = validateDecisions(candidates, decisions);
const coverageGaps = axisVerdicts.flatMap((verdict) => verdict.coverageGaps.map((gap) => `${verdict.axis}: ${gap}`));
if (failedFocuses.length > 0) coverageGaps.push("One or more review workers failed.");
if (truncatedFocuses.length > 0 || planningContext.planningPatchTruncated) {
	coverageGaps.push("Review evidence was truncated.");
}
if (packedNotes.omittedIds.length > 0) coverageGaps.push("Review notes were omitted from final fan-in.");
const coverageComplete = decisionReconciliation.complete && coverageGaps.length === 0;

return {
	scope: {
		files: files.length,
		compare,
		axes: activeAxes,
		statusText: boundaryChange.statusText,
		stat: boundaryChange.stat,
		changedFiles: boundaryChange.changedFiles,
		nameStatus: boundaryChange.nameStatus,
		commitList,
		pathScopeCoverage,
	},
	plan: {
		summary: plan.summary,
		partitions: partitions.length,
		focuses: focuses.length,
		assignmentCoverage,
		axisAssignmentCoverage,
	},
	candidates: candidates.length,
	candidateReceipts: candidates.map(candidateReceipt),
	failedFocuses,
	truncatedFocuses,
	planningPatchTruncated: planningContext.planningPatchTruncated,
	noteIdsOmitted: packedNotes.omittedIds,
	coverageGaps,
	coverageComplete,
	decisionReconciliation,
	meta: { decisions, axisVerdicts },
};
