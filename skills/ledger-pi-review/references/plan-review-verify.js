// Decomposed change template: plan cohesive partitions, fan out narrow reviews, then deeply verify.
// Adapt the referenced prompts for this change and inline them; preserve their evidence and output contracts.
const READ_ONLY = ["read", "grep", "find", "ls"];
const PLANNER = "<adapt references/planner.md for this change and inline it here>";
const REVIEWER = "<adapt references/reviewer.md for each focus and inline it here>";
const VERIFIER = "<adapt references/verifier.md for this change and inline it here>";

const files = (inputs.paths || "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const background = (inputs.background || "").trim();
const compare = (inputs.compare || "HEAD").trim();
if (files.length === 0) throw new Error("inputs.paths is required (newline-separated repository paths)");
if (!compare) throw new Error("inputs.compare is required");






const change = await std.git.change({ compare, paths: files });
const rawPlanningPatch = change.patch;
const changeStatus = change.statusText;
const { untrackedFiles } = change;
const planningContext = std.context.fit(
  { ...{ files, untrackedFiles, background, compare, changeStatus, changeStat: change.stat }, ["changePatch"]: std.context.clippable(rawPlanningPatch, { maxChars: 12000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
  { flags: { ["changePatchTruncated"]: `$.${"changePatch"}` } },
).value;

const plan = await agent({
  name: "review-planner",
  profile: "balanced",
  tools: READ_ONLY,
  systemPrompt: PLANNER,
  task: "Partition the change and define focused investigations. Return the typed plan.",
  context: planningContext,
  outputSchema: std.schema({"summary":"string","partitions":{"array":{"minItems":1},"items":[{"title":"string","files":{"array":{"minItems":1},"items":["string"]},"contextFiles":["string"],"rationale":"string","focuses":{"array":{"minItems":1},"items":[{"title":"string","priority":["high","medium","low"],"question":"string","checks":{"array":{"minItems":1},"items":["string"]},"rationale":"string"}]}}]}}),
});

const selectedPaths = new Set(files);
const partitions = plan.partitions.map((partition, partitionIndex) => {
  const outsideScope = partition.files.filter((path) => !selectedPaths.has(path));
  if (outsideScope.length > 0) {
    throw new Error(`Planner assigned non-selected changed paths: ${outsideScope.join(", ")}`);
  }
  return { id: `partition-${partitionIndex + 1}`, ...partition };
});
const assignedPaths = partitions.flatMap((partition) => partition.files);
const uniqueAssignedPaths = [...new Set(assignedPaths)];
const assignmentCoverage = std.coverage.compare(
  files.map((path) => ({ path })),
  uniqueAssignedPaths.map((path) => ({ path })),
  { id: "path" },
);
const assignmentReport = {
  complete: assignmentCoverage.complete,
  covered: assignmentCoverage.covered.map((item) => item.path),
  missing: assignmentCoverage.missing.map((item) => item.path),
  unexpected: assignmentCoverage.unexpected.map((item) => item.path),
  overlapping: [...new Set(assignedPaths.filter((path, index) => assignedPaths.indexOf(path) !== index))],
};
const uncoveredFiles = assignmentReport.missing;
const focuses = partitions.flatMap((partition) =>
  partition.focuses.map((focus, focusIndex) => ({
    id: `${partition.id}-focus-${focusIndex + 1}`,
    partitionId: partition.id,
    partitionTitle: partition.title,
    targetFiles: partition.files,
    contextFiles: partition.contextFiles,
    partitionRationale: partition.rationale,
    ...focus,
  })),
);

const reviews = await parallel(
  focuses,
  async (focus) => {
    let reviewContext;
    try {
      const rawPatch = await std.git.patch({ compare, paths: focus.targetFiles });
      reviewContext = std.context.fit(
  { ...{
          focus,
          background,
          compare,
          untrackedFiles: untrackedFiles.filter((path) => focus.targetFiles.includes(path)),
        }, ["patch"]: std.context.clippable(rawPatch, { maxChars: 16000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
  { flags: { ["patchTruncated"]: `$.${"patch"}` } },
).value;
    } catch (error) {
      return { focus, status: "failed", findings: [], notes: [], patchTruncated: false, error: String(error) };
    }

    const result = await agents.run({
      name: focus.id,
      profile: "quick",
      tools: READ_ONLY,
      systemPrompt: REVIEWER,
      task: "Investigate the assigned partition focus and return the typed review result.",
      context: reviewContext,
      outputSchema: std.schema({"findings":[{"title":"string","severity":["critical","significant","minor"],"path":"string","startLine?":{"int":{"minimum":1}},"endLine?":{"int":{"minimum":1}},"trigger":"string","evidence":"string","impact":"string","recommendation":"string"}],"notes":[{"topic":"string","observation":"string"}]}),
    });

    return {
      focus,
      status: result.status,
      findings: result.value?.findings ?? [],
      notes: result.value?.notes ?? [],
      patchTruncated: reviewContext.patchTruncated,
      error: result.error,
    };
  },
  6,
);

const candidates = [];
const notes = [];
for (const review of reviews) {
  for (const [index, finding] of review.findings.entries()) {
    candidates.push({
      candidateId: `${review.focus.id}-candidate-${index + 1}`,
      focusId: review.focus.id,
      scopeValid: review.focus.targetFiles.includes(finding.path),
      ...finding,
    });
  }
  for (const note of review.notes) notes.push({ focusId: review.focus.id, ...note });
}

const failedFocuses = reviews
  .filter((review) => review.status !== "completed")
  .map((review) => ({ id: review.focus.id, error: review.error || "worker failed" }));
const truncatedFocuses = reviews.filter((review) => review.patchTruncated).map((review) => review.focus.id);
const focusCoverage = reviews.map((review) => ({
  id: review.focus.id,
  partitionId: review.focus.partitionId,
  partitionTitle: review.focus.partitionTitle,
  targetFiles: review.focus.targetFiles,
  question: review.focus.question,
  status: review.status,
  patchTruncated: review.patchTruncated,
}));
const candidatePaths = [...new Set(candidates.map((candidate) => candidate.path))];
let rawVerificationPatch = "";
if (candidatePaths.length > 0) rawVerificationPatch = await std.git.patch({ compare, paths: candidatePaths });
const verifierCandidates = std.context.pack(
  candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    focusId: candidate.focusId,
    scopeValid: candidate.scopeValid,
    title: candidate.title,
    severity: candidate.severity,
    path: candidate.path,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    trigger: candidate.trigger,
    evidence: candidate.evidence,
    impact: candidate.impact,
    recommendation: candidate.recommendation,
  })),
  {
    fields: { title: 180, trigger: 500, evidence: 700, impact: 400, recommendation: 300, topic: 160, observation: 400, message: 700, reason: 300 },
    maxSerializedChars: 12000,
    id: "candidateId",
    priority: (candidate) => (candidate.severity === "critical" ? 3 : candidate.severity === "significant" ? 2 : 1),
  },
);
const verifierNotes = std.context.pack(
  notes.map((note, index) => ({
    id: `${note.focusId}-note-${index + 1}`,
    focusId: note.focusId,
    topic: note.topic,
    observation: note.observation,
  })),
  { fields: { title: 180, trigger: 500, evidence: 700, impact: 400, recommendation: 300, topic: 160, observation: 400, message: 700, reason: 300 }, maxSerializedChars: 8000, id: "id" },
);
const verifierContext = std.context.fit(
  { ...{
    files,
    untrackedFiles,
    background,
    compare,
    changeStatus,
    changeStat: change.stat,
    planSummary: plan.summary,
    assignmentCoverage: assignmentReport,
    focusCoverage,
    candidates: verifierCandidates.items,
    candidatesOmitted: verifierCandidates.omitted.length,
    candidateIdsOmitted: verifierCandidates.omittedIds,
    notes: verifierNotes.items,
    notesOmitted: verifierNotes.omitted.length,
    noteIdsOmitted: verifierNotes.omittedIds,
    failedFocuses,
    uncoveredFiles,
    truncatedFocuses,
    planningPatchTruncated: planningContext.changePatchTruncated,
  }, ["verificationPatch"]: std.context.clippable(rawVerificationPatch, { maxChars: 8000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
  { flags: { ["verificationPatchTruncated"]: `$.${"verificationPatch"}` } },
).value;

const meta = await agent({
  name: "review-verifier",
  profile: "deep",
  tools: READ_ONLY,
  systemPrompt: VERIFIER,
  task: "Verify every candidate and assess the review coverage. Return the typed verdict.",
  context: verifierContext,
  outputSchema: std.schema({"decisions":[{"candidateId":"string","title":"string","path":"string","startLine?":{"int":{"minimum":1}},"status":["confirmed","rejected","unresolved","duplicate"],"severity?":["critical","significant","minor"],"duplicateOf?":"string","trigger?":"string","evidence?":"string","impact?":"string","recommendation?":"string","reason":"string"}],"summary":"string","compoundRisks":["string"],"residualRisks":["string"],"coverageGaps":["string"]}),
});

const decisionReconciliation = std.reconcile.byId(candidates, meta.decisions, { id: "candidateId" });
const reconciledById = new Map(decisionReconciliation.values.map((candidate) => [candidate.candidateId, candidate]));
const normalizedDecisions = meta.decisions.map((decision) => ({
  ...reconciledById.get(decision.candidateId),
  ...decision,
}));
const normalizedMeta = { ...meta, decisions: normalizedDecisions };
const undecidedIds = new Set(decisionReconciliation.missingIds);
const undecidedCandidates = decisionReconciliation.values.filter((candidate) => undecidedIds.has(candidate.candidateId));

return {
  scope: { files: files.length, compare },
  plan: {
    summary: plan.summary,
    partitions: partitions.length,
    focuses: focuses.length,
    assignmentCoverage: assignmentReport,
  },
  candidates: candidates.length,
  failedFocuses,
  assignmentCoverage: assignmentReport,
  uncoveredFiles,
  truncatedFocuses,
  planningPatchTruncated: planningContext.changePatchTruncated,
  verificationPatchTruncated: verifierContext.verificationPatchTruncated,
  decisionReconciliation: {
    unknownIds: decisionReconciliation.unknownIds,
    missingIds: decisionReconciliation.missingIds,
    duplicateIds: decisionReconciliation.duplicateIds,
  },
  unknownDecisionIds: decisionReconciliation.unknownIds,
  missingDecisionIds: decisionReconciliation.missingIds,
  duplicateDecisionIds: decisionReconciliation.duplicateIds,
  undecidedCandidates,
  meta: normalizedMeta,
};
