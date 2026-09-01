// Fixed multi-lens template: independent axis-labelled lanes -> optional lane reducers -> final axis reducers.
// Each inputs.lenses line is: axis | title | falsifiable question.
const READ_ONLY = ["read", "grep", "find", "ls"];
const REVIEWER = "<inline adapted references/reviewer.md>";
const VERIFIER = "<inline adapted references/verifier.md>";
const AXES = ["standards", "intent"];

const files = (inputs.paths || "")
	.split("\n")
	.map((path) => path.trim())
	.filter(Boolean);
const contextFiles = (inputs.contextPaths || "")
	.split("\n")
	.map((path) => path.trim())
	.filter(Boolean);
const lenses = (inputs.lenses || "")
	.split("\n")
	.map((line) => line.trim())
	.filter(Boolean)
	.map((line, index) => {
		const [axis, title, question, ...extra] = line.split("|").map((part) => part.trim());
		if (extra.length > 0 || !AXES.includes(axis) || !title || !question) {
			throw new Error(`inputs.lenses line ${index + 1} must be: axis | title | falsifiable question`);
		}
		return { id: `lens-${index + 1}`, axis, title, question };
	});
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
if (files.length === 0 || lenses.length < 2 || !compare || expectedAxes.length === 0) {
	throw new Error("inputs.paths, at least two independent lenses, inputs.compare, and inputs.axes are required");
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
const lensAxes = [...new Set(lenses.map((lens) => lens.axis))];
const unexpectedAxes = lensAxes.filter((axis) => !expectedAxes.includes(axis));
const missingAxes = expectedAxes.filter((axis) => !lensAxes.includes(axis));
if (unexpectedAxes.length > 0 || missingAxes.length > 0) {
	throw new Error(
		`lens axis coverage mismatch; missing: ${missingAxes.join(", ") || "none"}; unexpected: ${unexpectedAxes.join(", ") || "none"}`,
	);
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

function validateFreshDecisions(candidates, decisions) {
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
			decision.contract !== candidate.contract ||
			decision.priorDisposition !== "not-applicable"
		) {
			throw new Error(`decision ${decision.candidateId} changed the canonical fresh candidate contract`);
		}
		const effective = decision.status === "duplicate" ? terminalDecision(decision) : decision;
		const live = ["confirmed", "unresolved"].includes(effective.status);
		const material = ["critical", "significant"].includes(effective.severity);

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
	}

	return reconciliation;
}

const boundaryChange = await std.git.change({ compare });
const change = await std.git.change({ compare, paths: files });
const boundaryPaths = [...new Set([...boundaryChange.changedFiles, ...boundaryChange.untrackedFiles])];
const scopedPaths = [...new Set([...change.changedFiles, ...change.untrackedFiles])];
if (boundaryPaths.length === 0) throw new Error("coverage failure: the selected comparison is empty");
const pathScopeCoverage = std.coverage.compare(boundaryPaths, scopedPaths);
if (!pathScopeCoverage.complete) {
	throw new Error(`coverage failure: requested paths omit ${pathScopeCoverage.missing.join(", ")}`);
}
const commitList =
	compare === "HEAD"
		? []
		: (await pi.bash({ command: `git log --oneline ${compare.slice(0, -7)}..HEAD` })).output
				.trim()
				.split("\n")
				.filter(Boolean);
const bounded = std.context.fit(
	{
		files,
		contextFiles,
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
		patch: std.context.clippable(change.patch, {
			maxChars: 16000,
			strategy: "head-tail",
			marker: "\n\n[... review patch clipped ...]\n\n",
		}),
	},
	{ flags: { patchTruncated: "$.patch" } },
).value;

const reviews = await parallel(lenses, async (lens) => {
	const focus = {
		...lens,
		partitionId: "fixed-lenses",
		partitionTitle: "Fixed lenses",
		targetFiles: files,
		contextFiles,
		priority: "high",
		checks: ["Trace producers, consumers, guards, and tests for this question."],
		rationale: background,
	};
	try {
		const result = await agent.run({
			name: lens.id,
			profile: "quick",
			tools: READ_ONLY,
			systemPrompt: REVIEWER,
			task: "Perform the assigned read-only, evidence-backed lens investigation.",
			context: { ...bounded, focus },
			outputSchema: findingSchema,
		});
		return {
			lens,
			focus,
			status: result.status,
			findings: result.value?.findings ?? [],
			notes: result.value?.notes ?? [],
			error: result.error,
		};
	} catch (error) {
		return { lens, focus, status: "failed", findings: [], notes: [], error: String(error) };
	}
});

const candidates = [];
const notes = [];
for (const review of reviews) {
	for (const [index, finding] of review.findings.entries()) {
		if (finding.axis !== review.lens.axis) throw new Error(`axis mismatch in ${review.lens.id}`);
		candidates.push({
			...finding,
			candidateId: `${review.lens.id}-candidate-${index + 1}`,
			source: "fresh",
			focusId: review.lens.id,
			scope: files.includes(finding.path) ? "in-scope" : "out-of-scope",
			loadBearing: false,
		});
	}
	for (const [index, note] of review.notes.entries()) {
		notes.push({ id: `${review.lens.id}-note-${index + 1}`, focusId: review.lens.id, ...note });
	}
}

const failedFocuses = reviews
	.filter((review) => review.status !== "completed")
	.map((review) => ({ id: review.lens.id, error: review.error || "worker failed" }));
const focusCoverage = reviews.map((review) => ({
	id: review.lens.id,
	axis: review.lens.axis,
	targetFiles: files,
	question: review.lens.question,
	status: review.status,
	patchTruncated: bounded.patchTruncated,
}));
const packedNotes = std.context.pack(notes, {
	id: "id",
	fields: { topic: 160, observation: 400 },
	maxSerializedChars: 8000,
});

async function verifyAxis(axis) {
	const members = candidates
		.filter((candidate) => candidate.axis === axis)
		.map((candidate) => ({ ...candidate, priority: priorityFor(candidate) }));
	let packedCandidates = std.context.pack(members, {
		id: "candidateId",
		priority: "priority",
		maxSerializedChars: 12000,
	});
	let reductionEvidence = [];

	if (packedCandidates.omitted.length > 0) {
		const axisReviews = reviews.filter((review) => review.lens.axis === axis);
		reductionEvidence = await parallel(axisReviews, async (review) => {
			const group = members.filter((candidate) => candidate.focusId === review.lens.id);
			if (group.length === 0) return null;
			const batch = std.context.pack(group, {
				id: "candidateId",
				priority: "priority",
				maxSerializedChars: 12000,
			});
			if (batch.omitted.length > 0) {
				throw new Error(`coverage failure: lens ${review.lens.id} omitted ${batch.omittedIds.join(", ")}`);
			}
			const verdict = await agent({
				name: `${review.lens.id}-reducer`,
				profile: "balanced",
				tools: READ_ONLY,
				systemPrompt: VERIFIER,
				task: "Independently inspect and decide this complete same-axis lens.",
				context: {
					axis,
					files,
					standardsPaths,
					intentPaths,
					smellBaselinePath,
					background,
					compare,
					patch: bounded.patch,
					patchTruncated: bounded.patchTruncated,
					candidates: batch.items,
				},
				outputSchema: decisionSchema,
			});
			validateFreshDecisions(group, verdict.decisions);
			return {
				groupId: review.lens.id,
				candidateReceipts: group.map(candidateReceipt),
				...verdict,
			};
		});
		reductionEvidence = reductionEvidence.filter(Boolean);
		const packedReductions = std.context.pack(
			reductionEvidence.map((verdict) => ({ id: verdict.groupId, priority: 1, verdict })),
			{ id: "id", priority: "priority", maxSerializedChars: 24000 },
		);
		if (packedReductions.omitted.length > 0) {
			throw new Error(`coverage failure: final ${axis} fan-in omitted semantic reductions`);
		}
		packedCandidates = packedReductions;
	}

	const finalVerdict = await agent({
		name: `${axis}-verifier`,
		profile: "deep",
		tools: READ_ONLY,
		systemPrompt: VERIFIER,
		task: "Independently decide every original same-axis candidate exactly once and assess coverage.",
		context: {
			axis,
			files,
			standardsPaths,
			intentPaths,
			smellBaselinePath,
			expectedAxes,
			background,
			compare,
			patch: bounded.patch,
			patchTruncated: bounded.patchTruncated,
			candidateIds: members.map((candidate) => candidate.candidateId),
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
			truncatedFocuses: bounded.patchTruncated
				? focusCoverage.filter((focus) => focus.axis === axis).map((focus) => focus.id)
				: [],
		},
		outputSchema: decisionSchema,
	});
	const reconciliation = validateFreshDecisions(
		candidates.filter((candidate) => candidate.axis === axis),
		finalVerdict.decisions,
	);
	return { axis, reconciliation, ...finalVerdict };
}

const activeAxes = expectedAxes;
const axisVerdicts = await Promise.all(activeAxes.map(verifyAxis));
const decisions = axisVerdicts.flatMap((verdict) => verdict.decisions);
const decisionReconciliation = validateFreshDecisions(candidates, decisions);
const coverageGaps = axisVerdicts.flatMap((verdict) => verdict.coverageGaps.map((gap) => `${verdict.axis}: ${gap}`));
if (failedFocuses.length > 0) coverageGaps.push("One or more review workers failed.");
if (bounded.patchTruncated) coverageGaps.push("Review evidence was truncated.");
if (packedNotes.omittedIds.length > 0) coverageGaps.push("Review notes were omitted from final fan-in.");
const coverageComplete = decisionReconciliation.complete && coverageGaps.length === 0;

return {
	scope: {
		files: files.length,
		lenses: lenses.length,
		compare,
		axes: activeAxes,
		statusText: boundaryChange.statusText,
		stat: boundaryChange.stat,
		changedFiles: boundaryChange.changedFiles,
		nameStatus: boundaryChange.nameStatus,
		commitList,
		pathScopeCoverage,
	},
	candidates: candidates.length,
	candidateReceipts: candidates.map(candidateReceipt),
	failedFocuses,
	patchTruncated: bounded.patchTruncated,
	noteIdsOmitted: packedNotes.omittedIds,
	coverageGaps,
	coverageComplete,
	decisionReconciliation,
	meta: { decisions, axisVerdicts },
};
