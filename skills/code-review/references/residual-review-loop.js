// Residual review template: one axis investigation -> coverage triage -> one bounded residual wave -> final axis verifier.
const READ_ONLY = ["read", "grep", "find", "ls"];
const REVIEWER = "<inline adapted references/reviewer.md>";
const TRIAGE_VERIFIER = "<inline adapted references/verifier.md for coverage triage>";
const FINAL_VERIFIER = "<inline adapted references/verifier.md for final verification>";
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
const smellBaselinePath = (inputs.smellBaselinePath || "").trim();
const axis = (inputs.axis || "").trim();
const question = (inputs.question || "").trim();
const background = (inputs.background || "").trim();
const compare = (inputs.compare || "").trim();
if (files.length === 0 || !AXES.includes(axis) || !question || !compare) {
	throw new Error("inputs.paths, axis (standards|intent), question, and compare are required");
}
if (compare !== "HEAD" && !/^[A-Za-z0-9._/@{}~^:+-]+\.\.\.HEAD$/.test(compare)) {
	throw new Error("inputs.compare must be HEAD for working-tree review or an explicit <fixed-point>...HEAD range");
}
if (axis === "standards" && !smellBaselinePath) {
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

function validateFreshDecisions(candidates, decisions) {
	const reconciliation = std.reconcile.byId(candidates, decisions, { id: "candidateId" });
	if (
		reconciliation.unknownIds.length > 0 ||
		reconciliation.missingIds.length > 0 ||
		reconciliation.duplicateIds.length > 0
	) {
		throw new Error("coverage failure: decisions have unknown, missing, or duplicate candidate IDs");
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
			if (!next || next.axis !== axis) {
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
			decision.axis !== axis ||
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
		standardsPaths,
		intentPaths,
		smellBaselinePath,
		axis,
		question,
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

async function investigate(id, focusQuestion) {
	const focus = {
		id,
		axis,
		title: focusQuestion,
		question: focusQuestion,
		partitionId: "residual-loop",
		partitionTitle: axis,
		targetFiles: files,
		checks: ["Trace the stated contract through changed branches, producers, consumers, guards, and tests."],
		rationale: background,
	};
	try {
		const result = await agent.run({
			name: id,
			profile: "quick",
			tools: READ_ONLY,
			systemPrompt: REVIEWER,
			task: "Perform the assigned read-only, evidence-backed axis investigation.",
			context: { ...bounded, focus },
			outputSchema: findingSchema,
		});
		return {
			id,
			focus,
			status: result.status,
			findings: result.value?.findings ?? [],
			notes: result.value?.notes ?? [],
			error: result.error,
		};
	} catch (error) {
		return { id, focus, status: "failed", findings: [], notes: [], error: String(error) };
	}
}

function candidateize(review) {
	return review.findings.map((finding, index) => {
		if (finding.axis !== axis) throw new Error(`axis mismatch in ${review.id}`);
		return {
			...finding,
			candidateId: `${review.id}-candidate-${index + 1}`,
			source: "fresh",
			focusId: review.id,
			scope: files.includes(finding.path) ? "in-scope" : "out-of-scope",
			loadBearing: false,
		};
	});
}

const initial = await investigate("initial", question);
const initialCandidates = candidateize(initial);
const initialPack = std.context.pack(
	initialCandidates.map((candidate) => ({ ...candidate, priority: priorityFor(candidate) })),
	{
		id: "candidateId",
		priority: "priority",
		maxSerializedChars: 12000,
	},
);
if (initialPack.omitted.length > 0) {
	throw new Error(
		`coverage failure: triage omitted ${initialPack.omittedIds.join(", ")}; no clean output is allowed`,
	);
}

const triage = await agent({
	name: "coverage-triage",
	profile: "balanced",
	tools: READ_ONLY,
	systemPrompt: TRIAGE_VERIFIER,
	task: "Decide every initial candidate and return only material, falsifiable residual coverage questions.",
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
		candidates: initialPack.items,
		focusCoverage: [
			{
				id: initial.id,
				axis,
				question,
				status: initial.status,
				patchTruncated: bounded.patchTruncated,
			},
		],
		notes: initial.notes,
		failedFocuses:
			initial.status === "completed" ? [] : [{ id: initial.id, error: initial.error || "worker failed" }],
		truncatedFocuses: bounded.patchTruncated ? [initial.id] : [],
	},
	outputSchema: decisionSchema,
});
validateFreshDecisions(initialCandidates, triage.decisions);

const materialGaps = [...new Set(triage.coverageGaps.filter((gap) => typeof gap === "string" && gap.trim()))];
// Every material gap is submitted. Pi's configured limits may queue or fail work, but this program does not cap it.
const residuals = await parallel(materialGaps, (gap, index) => investigate(`residual-${index + 1}`, gap));
const reviews = [initial, ...residuals];
const candidates = reviews.flatMap(candidateize);
if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) {
	throw new Error("candidate IDs must be unique");
}

const notes = reviews.flatMap((review) =>
	review.notes.map((note, index) => ({
		id: `${review.id}-note-${index + 1}`,
		focusId: review.id,
		...note,
	})),
);
const packedNotes = std.context.pack(notes, {
	id: "id",
	fields: { topic: 160, observation: 400 },
	maxSerializedChars: 8000,
});
const failedFocuses = reviews
	.filter((review) => review.status !== "completed")
	.map((review) => ({ id: review.id, error: review.error || "worker failed" }));
const focusCoverage = reviews.map((review) => ({
	id: review.id,
	axis,
	targetFiles: files,
	question: review.focus.question,
	status: review.status,
	patchTruncated: bounded.patchTruncated,
}));

let packedCandidates = std.context.pack(
	candidates.map((candidate) => ({ ...candidate, priority: priorityFor(candidate) })),
	{
		id: "candidateId",
		priority: "priority",
		maxSerializedChars: 12000,
	},
);
let reductionEvidence = [];
if (packedCandidates.omitted.length > 0) {
	reductionEvidence = await parallel(reviews, async (review) => {
		const group = candidateize(review).map((candidate) => ({
			...candidate,
			priority: priorityFor(candidate),
		}));
		if (group.length === 0) return null;
		const batch = std.context.pack(group, {
			id: "candidateId",
			priority: "priority",
			maxSerializedChars: 12000,
		});
		if (batch.omitted.length > 0) {
			throw new Error(`coverage failure: residual batch ${review.id} omitted ${batch.omittedIds.join(", ")}`);
		}
		const verdict = await agent({
			name: `${review.id}-reducer`,
			profile: "balanced",
			tools: READ_ONLY,
			systemPrompt: TRIAGE_VERIFIER,
			task: "Independently inspect and decide this complete residual semantic batch.",
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
			groupId: review.id,
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
		throw new Error("coverage failure: final axis verifier cannot receive every residual reduction");
	}
	packedCandidates = packedReductions;
}

const finalVerdict = await agent({
	name: "final-axis-verifier",
	profile: "deep",
	tools: READ_ONLY,
	systemPrompt: FINAL_VERIFIER,
	task: "Independently decide every original candidate in this axis exactly once and assess final coverage.",
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
		candidateIds: candidates.map((candidate) => candidate.candidateId),
		candidates: reductionEvidence.length > 0 ? [] : packedCandidates.items,
		reductionEvidence: reductionEvidence.length > 0 ? packedCandidates.items : [],
		triageDecisions: triage.decisions,
		triageCoverageGaps: materialGaps,
		focusCoverage,
		notes: packedNotes.items,
		noteIdsOmitted: packedNotes.omittedIds,
		failedFocuses,
		truncatedFocuses: bounded.patchTruncated ? reviews.map((review) => review.id) : [],
	},
	outputSchema: decisionSchema,
});
const decisionReconciliation = validateFreshDecisions(candidates, finalVerdict.decisions);
const coverageGaps = finalVerdict.coverageGaps.map((gap) => `${axis}: ${gap}`);
if (failedFocuses.length > 0) coverageGaps.push("One or more review workers failed.");
if (bounded.patchTruncated) coverageGaps.push("Review evidence was truncated.");
if (packedNotes.omittedIds.length > 0) coverageGaps.push("Review notes were omitted from final fan-in.");
const coverageComplete = decisionReconciliation.complete && coverageGaps.length === 0;

return {
	scope: {
		files: files.length,
		axis,
		question,
		compare,
		statusText: boundaryChange.statusText,
		stat: boundaryChange.stat,
		changedFiles: boundaryChange.changedFiles,
		nameStatus: boundaryChange.nameStatus,
		commitList,
		pathScopeCoverage,
	},
	initialCandidates: initialCandidates.length,
	materialCoverageGaps: materialGaps,
	residualPasses: residuals.length,
	candidateReceipts: candidates.map(candidateReceipt),
	failedFocuses,
	patchTruncated: bounded.patchTruncated,
	noteIdsOmitted: packedNotes.omittedIds,
	coverageGaps,
	coverageComplete,
	decisionReconciliation,
	meta: finalVerdict,
};
