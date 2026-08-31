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

let priorFindings = [];
if ((inputs.priorFindings || "").trim()) {
  const parsed = JSON.parse(inputs.priorFindings);
  if (!Array.isArray(parsed)) throw new Error("inputs.priorFindings must be a JSON array");
  priorFindings = parsed.map((finding) => ({
    candidateId: finding.candidateId,
    source: "prior",
    focusId: "prior-findings",
    scope: finding.scope,
    scopeValid: finding.scope === "in-scope",
    currentlyChanged: files.includes(finding.path),
    loadBearing: finding.loadBearing,
    suggestedOwner: finding.suggestedOwner,
    revisitCondition: finding.revisitCondition,
    title: finding.title,
    severity: finding.severity,
    path: finding.path,
    startLine: finding.startLine,
    endLine: finding.endLine,
    trigger: finding.trigger,
    evidence: finding.evidence,
    impact: finding.impact,
    recommendation: finding.recommendation,
  }));
  const required = ["candidateId", "title", "severity", "path", "trigger", "evidence", "impact", "recommendation"];
  for (const finding of priorFindings) {
    if (required.some((field) => typeof finding[field] !== "string" || !finding[field].trim())) {
      throw new Error(`each prior finding needs non-empty ${required.join(", ")}`);
    }
    if (!["critical", "significant", "minor"].includes(finding.severity)) {
      throw new Error(`invalid prior finding severity: ${finding.severity}`);
    }
    if (!["in-scope", "out-of-scope"].includes(finding.scope)) {
      throw new Error(`invalid prior finding scope: ${finding.scope}`);
    }
    if (typeof finding.loadBearing !== "boolean") {
      throw new Error(`prior finding ${finding.candidateId} needs boolean loadBearing`);
    }
    if (
      finding.scope === "out-of-scope" &&
      (typeof finding.suggestedOwner !== "string" ||
        !finding.suggestedOwner.trim() ||
        typeof finding.revisitCondition !== "string" ||
        !finding.revisitCondition.trim())
    ) {
      throw new Error(`out-of-scope prior finding ${finding.candidateId} needs suggestedOwner and revisitCondition`);
    }
    if (finding.path.startsWith("/") || finding.path.split("/").includes("..")) {
      throw new Error(`prior finding path must be repository-relative: ${finding.path}`);
    }
  }
  const priorIds = priorFindings.map((finding) => finding.candidateId);
  if (new Set(priorIds).size !== priorIds.length) throw new Error("inputs.priorFindings contains duplicate IDs");
}

const change = await std.git.change({ compare, paths: files });
const rawPlanningPatch = change.patch;
const changeStatus = change.statusText;
const { untrackedFiles } = change;
const planningContext = std.context.fit(
  { ...{ files, untrackedFiles, background, compare, changeStatus, changeStat: change.stat, priorFindings }, ["changePatch"]: std.context.clippable(rawPlanningPatch, { maxChars: 12000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
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
if (!assignmentCoverage.complete) {
  throw new Error(`planner coverage is incomplete: ${assignmentReport.missing.join(", ")}`);
}
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
          priorFindings: priorFindings.filter((finding) => focus.targetFiles.includes(finding.path)),
        }, ["patch"]: std.context.clippable(rawPatch, { maxChars: 16000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
  { flags: { ["patchTruncated"]: `$.${"patch"}` } },
).value;
    } catch (error) {
      return { focus, status: "failed", findings: [], notes: [], patchTruncated: false, error: String(error) };
    }

    const result = await agent.run({
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

const candidates = priorFindings.map((finding) => ({ ...finding }));
const allocatedCandidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
const notes = [];
for (const review of reviews) {
  for (const [index, finding] of review.findings.entries()) {
    const baseId = `fresh-${review.focus.id}-candidate-${index + 1}`;
    let candidateId = baseId;
    let collision = 2;
    while (allocatedCandidateIds.has(candidateId)) {
      candidateId = `${baseId}-rerun-${collision}`;
      collision += 1;
    }
    allocatedCandidateIds.add(candidateId);
    const scopeValid = review.focus.targetFiles.includes(finding.path);
    candidates.push({
      candidateId,
      source: "fresh",
      focusId: review.focus.id,
      scope: scopeValid ? "in-scope" : "out-of-scope",
      scopeValid,
      ...finding,
    });
  }
  for (const note of review.notes) notes.push({ focusId: review.focus.id, ...note });
}

const candidateIds = candidates.map((candidate) => candidate.candidateId);
if (new Set(candidateIds).size !== candidateIds.length) throw new Error("prior and fresh candidate IDs must be unique");

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
const freshCandidates = candidates
  .filter((candidate) => candidate.source !== "prior")
  .map((candidate) => ({
    candidateId: candidate.candidateId,
    source: candidate.source,
    focusId: candidate.focusId,
    scope: candidate.scope,
    scopeValid: candidate.scopeValid,
    currentlyChanged: candidate.currentlyChanged ?? true,
    title: candidate.title,
    severity: candidate.severity,
    path: candidate.path,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    trigger: candidate.trigger,
    evidence: candidate.evidence,
    impact: candidate.impact,
    recommendation: candidate.recommendation,
  }));
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
    priorFindings,
    candidates: freshCandidates,
    priorFindingIds: priorFindings.map((finding) => finding.candidateId),
    candidatesOmitted: 0,
    candidateIdsOmitted: [],
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
  outputSchema: std.schema({"decisions":[{"candidateId":"string","title":"string","path":"string","startLine?":{"int":{"minimum":1}},"status":["confirmed","rejected","unresolved","duplicate"],"priorDisposition":["not-applicable","addressed","open","rejected","unresolved"],"severity":["critical","significant","minor"],"scope":["in-scope","out-of-scope"],"loadBearing":"boolean","duplicateOf?":"string","trigger?":"string","evidence?":"string","impact?":"string","recommendation?":"string","suggestedOwner?":"string","revisitCondition?":"string","reason":"string"}],"summary":"string","compoundRisks":["string"],"residualRisks":["string"],"coverageGaps":["string"]}),
});

const decisionReconciliation = std.reconcile.byId(candidates, meta.decisions, { id: "candidateId" });
if (
  decisionReconciliation.unknownIds.length > 0 ||
  decisionReconciliation.duplicateIds.length > 0 ||
  decisionReconciliation.missingIds.length > 0
) {
  throw new Error("verifier must decide every candidate ID exactly once with no unknown IDs");
}
const reconciledById = new Map(decisionReconciliation.values.map((candidate) => [candidate.candidateId, candidate]));
const normalizedDecisions = meta.decisions.map((decision) => ({
  ...reconciledById.get(decision.candidateId),
  ...decision,
}));
const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
const decisionById = new Map(normalizedDecisions.map((decision) => [decision.candidateId, decision]));
const terminalDecision = (decision) => {
  const seen = new Set();
  let current = decision;
  while (current.status === "duplicate") {
    if (!current.duplicateOf || current.duplicateOf === current.candidateId || seen.has(current.candidateId)) {
      throw new Error(`duplicate decision chain is invalid for ${decision.candidateId}`);
    }
    seen.add(current.candidateId);
    current = decisionById.get(current.duplicateOf);
    if (!current) throw new Error(`duplicate target is missing for ${decision.candidateId}`);
  }
  if (!["confirmed", "rejected", "unresolved"].includes(current.status)) {
    throw new Error(`duplicate decision ${decision.candidateId} has no terminal disposition`);
  }
  if (current.severity !== decision.severity) {
    throw new Error(`duplicate decision ${decision.candidateId} must preserve terminal severity`);
  }
  return current;
};
for (const decision of normalizedDecisions) {
  const candidate = candidateById.get(decision.candidateId);
  if (!candidate) continue;
  const effective = decision.status === "duplicate" ? terminalDecision(decision) : decision;
  const expectedScope = candidate.scope;
  if (decision.scope !== expectedScope) {
    throw new Error(`decision ${decision.candidateId} must use scope ${expectedScope}`);
  }
  if (decision.scope === "out-of-scope" && ["confirmed", "unresolved"].includes(effective.status)) {
    if (!decision.suggestedOwner || !decision.revisitCondition) {
      throw new Error(`out-of-scope decision ${decision.candidateId} needs suggestedOwner and revisitCondition`);
    }
  }
  if (
    decision.scope === "in-scope" &&
    ["critical", "significant"].includes(effective.severity) &&
    ["confirmed", "unresolved"].includes(effective.status) &&
    !decision.loadBearing
  ) {
    throw new Error(`in-scope material decision ${decision.candidateId} must be load-bearing`);
  }
  if (effective.status === "confirmed") {
    for (const field of ["severity", "trigger", "evidence", "impact", "recommendation"]) {
      if (typeof effective[field] !== "string" || !effective[field].trim()) {
        throw new Error(`confirmed decision ${decision.candidateId} needs non-empty ${field}`);
      }
    }
  }
  if (candidate.source === "prior") {
    if (decision.priorDisposition === "not-applicable") {
      throw new Error(`prior finding ${decision.candidateId} needs a priorDisposition`);
    }
    if (effective.status === "confirmed" && decision.priorDisposition !== "open") {
      throw new Error(`confirmed prior finding ${decision.candidateId} must remain open`);
    }
    if (effective.status === "unresolved" && decision.priorDisposition !== "unresolved") {
      throw new Error(`unresolved prior finding ${decision.candidateId} needs unresolved disposition`);
    }
    if (effective.status === "rejected" && !["addressed", "rejected"].includes(decision.priorDisposition)) {
      throw new Error(`rejected prior finding ${decision.candidateId} must be addressed or rejected`);
    }
  } else if (decision.priorDisposition !== "not-applicable") {
    throw new Error(`fresh candidate ${decision.candidateId} must use priorDisposition not-applicable`);
  }
}
const outOfScopeDecisions = normalizedDecisions.filter((decision) => decision.scope === "out-of-scope");
const loadBearingMaterialDecisions = normalizedDecisions.filter(
  (decision) =>
    decision.loadBearing &&
    ["critical", "significant"].includes(decision.severity) &&
    ["confirmed", "unresolved"].includes(decision.status),
);
const normalizedMeta = { ...meta, decisions: normalizedDecisions };
const undecidedIds = new Set(decisionReconciliation.missingIds);
const undecidedCandidates = decisionReconciliation.values.filter((candidate) => undecidedIds.has(candidate.candidateId));
const priorDecisionCoverage = std.coverage.compare(
  priorFindings.map((finding) => ({ id: finding.candidateId })),
  normalizedDecisions
    .filter((decision) => priorFindings.some((finding) => finding.candidateId === decision.candidateId))
    .map((decision) => ({ id: decision.candidateId })),
  { id: "id" },
);
const priorDecisions = normalizedDecisions.filter((decision) =>
  priorFindings.some((finding) => finding.candidateId === decision.candidateId),
);
if (!priorDecisionCoverage.complete) {
  throw new Error("every prior finding must receive exactly one verified disposition");
}

return {
  scope: { files: files.length, compare },
  plan: {
    summary: plan.summary,
    partitions: partitions.length,
    focuses: focuses.length,
    assignmentCoverage: assignmentReport,
  },
  candidates: candidates.length,
  priorFindings: priorFindings.length,
  priorDecisionCoverage,
  priorDecisions,
  outOfScopeDecisions,
  loadBearingMaterialDecisions,
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
