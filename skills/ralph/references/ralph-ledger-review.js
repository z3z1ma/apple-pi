// Advanced example: Ledger Ralph increments with an inlined Review spine.
// Not the default. Prefer the ralph skill's Ledger program, then load review separately.
const READ_ONLY = ["read", "grep", "find", "ls"];
const RALPH_TOOLS = [...READ_ONLY, "bash", "edit", "write"];
// Load the review skill and adapt its planner, reviewer, and verifier prompt contracts before inlining them.
const PLANNER = "<adapt the review skill's planner prompt for this increment and inline it here>";
const REVIEWER = "<adapt the review skill's reviewer prompt for each focus and inline it here>";
const VERIFIER = "<adapt the review skill's verifier prompt for this increment; require priorCoverageGapIdsAssessed and priorRiskIdsAssessed to include only supplied gaps or risks that independent evidence resolves, then inline it here>";
// Adapt references/ledger-increment.md for this goal and its reviewed-loop feedback, then inline it here.
const RALPH = "<adapt references/ledger-increment.md for this goal, supplied review findings and coverage gaps, and the reviewed loop; inline it here>";

const goal = (inputs.goal || "").trim();
const task = (inputs.task || "").trim();
const stack = (inputs.stack || "")
  .split("\n")
  .map((path) => path.trim())
  .filter(Boolean);
const iterationInput = String(inputs.iterations ?? "").trim();
if (!goal) throw new Error("inputs.goal is required");
if (!task) throw new Error("inputs.task is required (ledger task.md path)");
if (stack.length === 0) throw new Error("inputs.stack is required (newline-separated context paths)");
if (!/^[1-9]\d*$/.test(iterationInput)) {
  throw new Error("inputs.iterations is required (positive safe integer)");
}
const iterations = Number(iterationInput);
if (!Number.isSafeInteger(iterations)) {
  throw new Error("inputs.iterations must be a positive safe integer");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

async function terminalTaskStatus() {
  const matches = await pi.grep({ path: task, pattern: "^Status:\\s*(?:done|blocked)\\s*$" });
  return /Status:\s*(done|blocked)\b/.exec(matches)?.[1];
}

async function gitOutput(command) {
  const result = await pi.bash({ command });
  if (!result.ok) throw new Error(result.output || `Git command failed: ${command}`);
  return result.output;
}



function stableContentId(prefix, value) {
  const text = String(value || "");
  let first = 2166136261;
  let second = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = ((first * 31) ^ code) >>> 0;
    second = (second * 131 + code) >>> 0;
  }
  return `${prefix}-${text.length}-${first.toString(36)}-${second.toString(36)}`;
}

function coverageGapRecords(messages) {
  const records = [];
  const seen = new Set();
  for (const rawMessage of messages || []) {
    const message = rawMessage == null ? "" : String(rawMessage);
    if (!message || seen.has(message)) continue;
    seen.add(message);
    records.push({ id: stableContentId("coverage-gap", message), message });
  }
  return records;
}

function normalizeRiskRecords(entries) {
  const records = [];
  const seen = new Set();
  for (const entry of entries || []) {
    const kind = entry?.kind === "compound" || entry?.kind === "residual" ? entry.kind : "";
    const rawMessage = entry?.message ?? entry?.risk;
    const message = rawMessage == null ? "" : String(rawMessage);
    if (!kind || !message) continue;
    const identity = `${kind}\u0000${message}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    records.push({
      id: stableContentId(`prior-${kind}-risk`, identity),
      kind,
      message,
    });
  }
  return records;
}

function riskRecordsFromMeta(compoundRisks, residualRisks) {
  return normalizeRiskRecords([
    ...(compoundRisks || []).map((message) => ({ kind: "compound", message })),
    ...(residualRisks || []).map((message) => ({ kind: "residual", message })),
  ]);
}


function isLedgerPath(path) {
  return path === ".ledger" || path.startsWith(".ledger/");
}

// std.git.change cannot tell whether a file was already dirty before an increment.
// These snapshots deliberately hash every dirty-tree path before and after the worker.
async function changedPaths() {
  const [status, diffNames, untracked] = await Promise.all([
    gitOutput("git status --short --untracked-files=all"),
    gitOutput("git diff --name-only HEAD"),
    gitOutput("git ls-files --others --exclude-standard -z"),
  ]);
  const names = new Set();
  for (const line of status.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const path = trimmed.slice(2).trim().split(" -> ").at(-1);
    if (path) names.add(path);
  }
  for (const path of diffNames.split("\n").map((line) => line.trim()).filter(Boolean)) names.add(path);
  for (const path of untracked.split("\0").filter(Boolean)) names.add(path);
  return [...names];
}

async function fingerprintPath(path) {
  const result = await pi.bash({
    command: `if [ -f ${shellQuote(path)} ]; then git hash-object -- ${shellQuote(path)}; else printf MISSING; fi`,
  });
  return (result.ok ? result.output : "MISSING").trim();
}

async function workspaceSnapshot() {
  const paths = await changedPaths();
  const entries = await parallel(paths, async (path) => [path, await fingerprintPath(path)]);
  return Object.fromEntries(entries);
}

function incrementPaths(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (path) => before[path] !== after[path],
  );
}

async function reviewChange(files, background, priorFindings, priorCoverageGaps, priorRisks = []) {
  const compare = "HEAD";
  const change = await std.git.change({ compare, paths: files });
  const { untrackedFiles } = change;
  const planningContext = std.context.fit(
  { ...{
      files,
      untrackedFiles,
      background,
      compare,
      changeStatus: change.statusText,
      changeStat: change.stat,
    }, ["changePatch"]: std.context.clippable(change.patch, { maxChars: 12000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
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
    files.map((path) => ({ id: path, path })),
    uniqueAssignedPaths.map((path) => ({ id: path, path })),
    { id: "id" },
  );
  const uncoveredFiles = assignmentCoverage.missing.map((entry) => entry.path);
  const unexpectedAssignedFiles = assignmentCoverage.unexpected.map((entry) => entry.path);
  const overlappingAssignedFiles = [...new Set(assignedPaths.filter((path, index) => assignedPaths.indexOf(path) !== index))];
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
  for (const [index, finding] of priorFindings.entries()) {
    const { status: _status, reason: _reason, duplicateOf: _duplicateOf, ...candidate } = finding;
    candidates.push({
      candidateId: `prior-finding-${index + 1}`,
      focusId: "prior-feedback",
      scopeValid: files.includes(candidate.path),
      ...candidate,
    });
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
  const focusCoverageResult = std.coverage.compare(
    focuses.map((focus) => ({ id: focus.id })),
    reviews.map((review) => ({ id: review.focus.id })),
    { id: "id" },
  );
  const candidatePaths = [...new Set(candidates.map((candidate) => candidate.path))];
  let rawVerificationPatch = "";
  if (candidatePaths.length > 0) rawVerificationPatch = await std.git.patch({ compare, paths: candidatePaths });
  const verifierCandidates = std.context.pack(
    candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      focusId: candidate.focusId,
      scopeValid: candidate.scopeValid,
      priority:
        (candidate.focusId === "prior-feedback" ? 3 : 0) +
        (candidate.severity === "critical" ? 3 : candidate.severity === "significant" ? 2 : 1),
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
    { fields: { title: 180, trigger: 500, evidence: 700, impact: 400, recommendation: 300, topic: 160, observation: 400, message: 700, reason: 300 }, maxSerializedChars: 12000, id: "candidateId", priority: "priority" },
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
  const priorCoverageGapRecords = coverageGapRecords(priorCoverageGaps);
  const packedPriorCoverageGaps = std.context.pack(
    priorCoverageGapRecords.map((gap) => ({
      id: gap.id,
      message: gap.message,
    })),
    {
      fields: { title: 180, trigger: 500, evidence: 700, impact: 400, recommendation: 300, topic: 160, observation: 400, message: 700, reason: 300 },
      maxSerializedChars: 8000,
      id: "id",
    },
  );
  const priorRiskRecords = normalizeRiskRecords(priorRisks);
  const packedPriorRisks = std.context.pack(
    priorRiskRecords.map((risk) => ({
      id: risk.id,
      kind: risk.kind,
      message: risk.message,
    })),
    {
      fields: { title: 180, trigger: 500, evidence: 700, impact: 400, recommendation: 300, topic: 160, observation: 400, message: 700, reason: 300 },
      maxSerializedChars: 8000,
      id: "id",
    },
  );
  const verifierContext = std.context.fit(
  { ...{
      files,
      untrackedFiles,
      background,
      compare,
      changeStatus: change.statusText,
      changeStat: change.stat,
      planSummary: plan.summary,
      focusCoverage,
      candidates: verifierCandidates.items,
      candidateIdsOmitted: verifierCandidates.omittedIds,
      priorCoverageGaps: packedPriorCoverageGaps.items,
      priorCoverageGapIdsOmitted: packedPriorCoverageGaps.omittedIds,
      priorRisks: packedPriorRisks.items,
      priorRiskIdsOmitted: packedPriorRisks.omittedIds,
      notes: verifierNotes.items,
      noteIdsOmitted: verifierNotes.omittedIds,
      notesOmitted: verifierNotes.omitted.length,
      failedFocuses,
      uncoveredFiles,
      unexpectedAssignedFiles,
      overlappingAssignedFiles,
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
    task: "Verify every candidate and assess the review coverage. Return the typed verdict, including only supplied priorCoverageGapIdsAssessed and priorRiskIdsAssessed IDs independently resolved by evidence.",
    context: verifierContext,
    outputSchema: std.schema({"decisions":[{"candidateId":"string","title":"string","path":"string","startLine?":{"int":{"minimum":1}},"status":["confirmed","rejected","unresolved","duplicate"],"severity?":["critical","significant","minor"],"duplicateOf?":"string","trigger?":"string","evidence?":"string","impact?":"string","recommendation?":"string","reason":"string"}],"summary":"string","compoundRisks":["string"],"residualRisks":["string"],"coverageGaps":["string"],"priorCoverageGapIdsAssessed":["string"],"priorRiskIdsAssessed":["string"]}),
  });

  const allCandidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const packedCandidateIds = new Set(verifierCandidates.items.map((candidate) => candidate.candidateId));
  const visibleDecisions = meta.decisions.filter((decision) => packedCandidateIds.has(decision.candidateId));
  const unknownDecisionIds = meta.decisions
    .filter((decision) => !allCandidateIds.has(decision.candidateId))
    .map((decision) => decision.candidateId);
  const decisionsForOmittedCandidates = meta.decisions
    .filter((decision) => allCandidateIds.has(decision.candidateId) && !packedCandidateIds.has(decision.candidateId))
    .map((decision) => decision.candidateId);
  const decisionCoverage = std.coverage.compare(
    candidates.map((candidate) => ({ id: candidate.candidateId })),
    visibleDecisions.map((decision) => ({ id: decision.candidateId })),
    { id: "id" },
  );
  const duplicateVisibleDecisionIds = new Set(decisionCoverage.duplicates.map((decision) => decision.id));
  const visibleDecisionsByCandidateId = new Map();
  for (const decision of visibleDecisions) {
    const decisions = visibleDecisionsByCandidateId.get(decision.candidateId) || [];
    decisions.push(decision);
    visibleDecisionsByCandidateId.set(decision.candidateId, decisions);
  }
  const duplicateChainMemo = new Map();
  const duplicateChainTerminates = (candidateId, visiting = new Set()) => {
    if (!allCandidateIds.has(candidateId) || !packedCandidateIds.has(candidateId) || visiting.has(candidateId)) return false;
    if (duplicateChainMemo.has(candidateId)) return duplicateChainMemo.get(candidateId);
    const decisions = visibleDecisionsByCandidateId.get(candidateId);
    if (decisions?.length !== 1) return false;
    const decision = decisions[0];
    if (decision.status === "confirmed" || decision.status === "unresolved") {
      duplicateChainMemo.set(candidateId, true);
      return true;
    }
    if (decision.status !== "duplicate" || typeof decision.duplicateOf !== "string") {
      duplicateChainMemo.set(candidateId, false);
      return false;
    }
    const duplicateOf = decision.duplicateOf;
    if (!duplicateOf || duplicateOf === candidateId) {
      duplicateChainMemo.set(candidateId, false);
      return false;
    }
    const nextVisiting = new Set(visiting);
    nextVisiting.add(candidateId);
    const terminates = duplicateChainTerminates(duplicateOf, nextVisiting);
    duplicateChainMemo.set(candidateId, terminates);
    return terminates;
  };
  const invalidDuplicateDecisionIds = new Set();
  for (const [candidateId, decisions] of visibleDecisionsByCandidateId) {
    if (!decisions.some((decision) => decision.status === "duplicate")) continue;
    if (decisions.length !== 1 || !duplicateChainTerminates(candidateId)) invalidDuplicateDecisionIds.add(candidateId);
  }
  const decisionsForReconciliation = visibleDecisions.filter(
    (decision) =>
      !duplicateVisibleDecisionIds.has(decision.candidateId) &&
      !invalidDuplicateDecisionIds.has(decision.candidateId),
  );
  const reconciliation = std.reconcile.byId(candidates, decisionsForReconciliation, { id: "candidateId" });
  const undecidedCandidates = candidates.filter((candidate) => reconciliation.missingIds.includes(candidate.candidateId));
  const reconciledDecisions = reconciliation.values.filter((decision) => decision.status !== undefined);
  const findings = [
    ...reconciledDecisions
      .filter((decision) => decision.status === "confirmed" || decision.status === "unresolved")
      .map((decision) => ({
        title: decision.title,
        severity: decision.severity,
        path: decision.path,
        status: decision.status,
        trigger: decision.trigger,
        evidence: decision.evidence,
        impact: decision.impact,
        recommendation: decision.recommendation,
        reason: decision.reason,
      })),
    ...undecidedCandidates.map((candidate) => ({
      title: candidate.title,
      severity: candidate.severity,
      path: candidate.path,
      status: "undecided",
      trigger: candidate.trigger,
      evidence: candidate.evidence,
      impact: candidate.impact,
      recommendation: candidate.recommendation,
    })),
  ];
  const suppliedPriorCoverageGapIdsAssessed = Array.isArray(meta.priorCoverageGapIdsAssessed)
    ? meta.priorCoverageGapIdsAssessed
    : [];
  const packedPriorCoverageGapIds = new Set(packedPriorCoverageGaps.items.map((gap) => gap.id));
  const assessedPriorCoverageGapIds = new Set(
    suppliedPriorCoverageGapIdsAssessed.filter((id) => packedPriorCoverageGapIds.has(id)),
  );
  const assessmentsForOmittedCoverageGaps = suppliedPriorCoverageGapIdsAssessed.filter(
    (id) => !packedPriorCoverageGapIds.has(id),
  );
  const unassessedPriorCoverageGaps = priorCoverageGapRecords.filter((gap) => !assessedPriorCoverageGapIds.has(gap.id));
  const suppliedPriorRiskIdsAssessed = Array.isArray(meta.priorRiskIdsAssessed) ? meta.priorRiskIdsAssessed : [];
  const packedPriorRiskIds = new Set(packedPriorRisks.items.map((risk) => risk.id));
  const assessedPriorRiskIds = new Set(
    suppliedPriorRiskIdsAssessed.filter((id) => packedPriorRiskIds.has(id)),
  );
  const assessmentsForOmittedRisks = suppliedPriorRiskIdsAssessed.filter((id) => !packedPriorRiskIds.has(id));
  const unassessedPriorRisks = priorRiskRecords.filter((risk) => !assessedPriorRiskIds.has(risk.id));
  const currentRiskRecords = riskRecordsFromMeta(meta.compoundRisks, meta.residualRisks);
  const retainedRiskRecords = normalizeRiskRecords([...currentRiskRecords, ...unassessedPriorRisks]);
  const invalidDuplicateCoverageGaps = [...invalidDuplicateDecisionIds].map(
    (id) =>
      `Verifier returned an invalid duplicate decision for candidate: ${id}; candidate remains undecided until duplicateOf names a distinct visible candidate with a unique decision chain terminating in confirmed or unresolved`,
  );
  const localCoverageGaps = [
    ...uncoveredFiles.map((path) => `Changed file was not assigned to a review partition: ${path}`),
    ...unexpectedAssignedFiles.map((path) => `Planner assigned a path outside the selected change: ${path}`),
    ...focusCoverageResult.missing.map((focus) => `Review focus did not return a result: ${focus.id}`),
    ...focusCoverageResult.unexpected.map((focus) => `Review returned an unexpected focus result: ${focus.id}`),
    ...focusCoverageResult.duplicates.map((focus) => `Review returned duplicate results for focus: ${focus.id}`),
    ...failedFocuses.map((focus) => `Review focus failed: ${focus.id} (${focus.error})`),
    ...truncatedFocuses.map((id) => `Review focus patch was truncated: ${id}`),
    ...(planningContext.changePatchTruncated ? ["Planning patch was truncated"] : []),
    ...verifierCandidates.omittedIds.map((id) => `Verifier candidate was omitted from bounded context: ${id}`),
    ...verifierNotes.omittedIds.map((id) => `Verifier note was omitted from bounded context: ${id}`),
    ...(verifierContext.verificationPatchTruncated ? ["Verification patch was truncated"] : []),
    ...candidates.filter((candidate) => !candidate.scopeValid).map((candidate) => `Review candidate is outside its assigned files: ${candidate.candidateId}`),
    ...decisionCoverage.missing.map((candidate) => `Verifier omitted a decision for candidate: ${candidate.id}`),
    ...decisionCoverage.unexpected.map((decision) => `Verifier returned an unknown candidate decision: ${decision.id}`),
    ...decisionCoverage.duplicates.map((decision) => `Verifier returned duplicate decisions for candidate: ${decision.id}`),
    ...unknownDecisionIds.map((id) => `Verifier returned an unknown candidate decision: ${id}`),
    ...decisionsForOmittedCandidates.map((id) => `Verifier attempted to decide an omitted candidate: ${id}`),
    ...assessmentsForOmittedCoverageGaps.map((id) => `Verifier attempted to assess an omitted coverage gap: ${id}`),
    ...assessmentsForOmittedRisks.map((id) => `Verifier attempted to assess an omitted prior risk: ${id}`),
    ...invalidDuplicateCoverageGaps,
    ...unassessedPriorCoverageGaps.map((gap) => gap.message),
    ...unassessedPriorRisks.map((risk) => `Prior ${risk.kind} risk was not assessed (${risk.id}): ${risk.message}`),
    ...packedPriorRisks.omittedIds.map((id) => `Prior risk was omitted from bounded verifier context: ${id}`),
    ...(meta.coverageGaps || []),
  ];
  const coverageGaps = coverageGapRecords(localCoverageGaps).map((gap) => gap.message);
  return {
    summary: meta.summary,
    plan: { summary: plan.summary, partitions: partitions.length, focuses: focuses.length },
    findings,
    failedFocuses,
    uncoveredFiles,
    coverageGaps,
    coverageComplete: coverageGaps.length === 0,
    compoundRisks: retainedRiskRecords.filter((risk) => risk.kind === "compound").map((risk) => risk.message),
    residualRisks: retainedRiskRecords.filter((risk) => risk.kind === "residual").map((risk) => risk.message),
    riskRecords: retainedRiskRecords,
    unknownDecisionIds,
    duplicateDecisionIds: [...duplicateVisibleDecisionIds],
    invalidDuplicateDecisionIds: [...invalidDuplicateDecisionIds],
    undecided: undecidedCandidates.length,
    undecidedCandidates,
    candidateIdsOmitted: verifierCandidates.omittedIds,
    noteIdsOmitted: verifierNotes.omittedIds,
    truncatedFocuses,
    planningPatchTruncated: planningContext.changePatchTruncated,
    verificationPatchTruncated: verifierContext.verificationPatchTruncated,
    coverage: {
      assignment: {
        missing: uncoveredFiles,
        unexpected: unexpectedAssignedFiles,
        overlapping: overlappingAssignedFiles,
        complete: assignmentCoverage.complete,
      },
      focuses: {
        missing: focusCoverageResult.missing.map((focus) => focus.id),
        unexpected: focusCoverageResult.unexpected.map((focus) => focus.id),
        duplicates: focusCoverageResult.duplicates.map((focus) => focus.id),
        complete: focusCoverageResult.complete,
      },
      decisions: {
        missing: decisionCoverage.missing.map((candidate) => candidate.id),
        unexpected: decisionCoverage.unexpected.map((decision) => decision.id),
        duplicates: decisionCoverage.duplicates.map((decision) => decision.id),
        complete: decisionCoverage.complete,
      },
    },
    meta: { ...meta, decisions: reconciledDecisions },
  };
}

function reviewFeedback(findings, coverageGaps, priorRisks = []) {
  const packedFindings = std.context.pack(
    findings.map((finding, index) => ({
      id: `finding-${index + 1}`,
      ...finding,
      priority: finding.severity === "critical" ? 3 : finding.severity === "significant" ? 2 : 1,
      title: finding.title,
      trigger: finding.trigger,
      evidence: finding.evidence,
      impact: finding.impact,
      recommendation: finding.recommendation,
    })),
    { fields: { title: 180, trigger: 500, evidence: 700, impact: 400, recommendation: 300, topic: 160, observation: 400, message: 700, reason: 300 }, maxSerializedChars: 12000, id: "id", priority: "priority" },
  );
  const gapRecords = coverageGapRecords(coverageGaps);
  const packedGaps = std.context.pack(
    gapRecords.map((gap) => ({ id: gap.id, message: gap.message })),
    { fields: { title: 180, trigger: 500, evidence: 700, impact: 400, recommendation: 300, topic: 160, observation: 400, message: 700, reason: 300 }, maxSerializedChars: 8000, id: "id" },
  );
  const riskRecords = normalizeRiskRecords(priorRisks);
  const packedRisks = std.context.pack(
    riskRecords.map((risk) => ({
      id: risk.id,
      kind: risk.kind,
      message: risk.message,
    })),
    { fields: { title: 180, trigger: 500, evidence: 700, impact: 400, recommendation: 300, topic: 160, observation: 400, message: 700, reason: 300 }, maxSerializedChars: 8000, id: "id" },
  );
  return {
    findings: packedFindings.items,
    findingsOmitted: packedFindings.omitted.length,
    coverageGaps: packedGaps.items,
    coverageGapIdsOmitted: packedGaps.omittedIds,
    coverageGapsOmitted: packedGaps.omitted.length,
    priorRisks: packedRisks.items,
    priorRiskIdsOmitted: packedRisks.omittedIds,
    priorRisksOmitted: packedRisks.omitted.length,
  };
}

function incrementTask() {
  return `Goal:\n${goal}\n\nReview feedback is bound in context. Address verified findings before new work, and do not treat coverage gaps as approval.`;
}

let findings = [];
let coverageGaps = [];
let priorRisks = [];
let lastReview;
const reviewedPaths = new Set();
const failures = [];

for (let iteration = 1; iteration <= iterations; iteration++) {
  const taskStatusBefore = await terminalTaskStatus();
  if (taskStatusBefore) {
    return {
      status: "stopped",
      stopReason: `task-${taskStatusBefore}`,
      requestedIterations: iterations,
      completedIterations: iteration - 1,
      iterations: iteration - 1,
      findings,
      coverageGaps,
      failures,
    };
  }
  const headBefore = (await gitOutput("git rev-parse HEAD")).trim();
  const before = await workspaceSnapshot();
  const feedback = reviewFeedback(findings, coverageGaps, priorRisks);
  const boundedWorkerContext = std.context.fit(
    {
      stack: std.context.required([...new Set([task, ...stack])]),
      reviewFeedback: std.context.required(feedback),
    },
    { maxSerializedChars: 32000 },
  );
  const result = await agents.run({
    name: `ralph-${iteration}`,
    profile: "coding",
    tools: RALPH_TOOLS,
    systemPrompt: RALPH,
    task: incrementTask(),
    context: boundedWorkerContext.value,
  });
  if (result.status === "failed") {
    failures.push({ iteration, error: result.error || String(result.text).slice(0, 500) });
    return { status: "failed", iterations: iteration, failedAt: iteration, findings, coverageGaps, failures };
  }

  const taskStatusAfter = await terminalTaskStatus();
  if (taskStatusAfter) {
    return {
      status: "stopped",
      stopReason: `task-${taskStatusAfter}`,
      requestedIterations: iterations,
      completedIterations: iteration,
      iterations: iteration,
      findings,
      coverageGaps,
      failures,
    };
  }

  const headAfter = (await gitOutput("git rev-parse HEAD")).trim();
  if (headBefore !== headAfter) {
    failures.push({
      iteration,
      error: "increment committed; review needs the uncommitted working tree",
    });
    return { status: "failed", iterations: iteration, failedAt: iteration, findings, coverageGaps, failures };
  }

  const changed = incrementPaths(before, await workspaceSnapshot());
  const product = changed.filter((path) => !isLedgerPath(path));
  if (product.length === 0) {
    if (coverageGaps.length > 0) {
      return {
        status: "review_incomplete",
        iterations: iteration,
        findings,
        coverageGaps,
        review: lastReview,
        failures,
      };
    }
    if (findings.length > 0) return { status: "stuck", iterations: iteration, findings, coverageGaps, review: lastReview, failures };
    return {
      status: iteration > 1 || changed.length > 0 ? "no_product_change" : "idle",
      iterations: iteration,
      findings,
      coverageGaps,
      review: lastReview,
      failures,
    };
  }

  for (const path of product) reviewedPaths.add(path);
  let review;
  try {
    review = await reviewChange(
      [...reviewedPaths],
      `${goal}\n\nPrior findings: ${findings.length}`,
      findings,
      coverageGaps,
      priorRisks,
    );
  } catch (error) {
    failures.push({ iteration, error: String(error) });
    return { status: "review_failed", iterations: iteration, failedAt: iteration, findings, coverageGaps, failures };
  }
  lastReview = review;
  findings = review.findings;
  coverageGaps = review.coverageGaps;
  priorRisks = review.riskRecords;
  if (review.failedFocuses.length > 0) {
    failures.push({ iteration, error: review.failedFocuses.map((focus) => focus.error).join("; ") });
    return { status: "review_failed", iterations: iteration, failedAt: iteration, review, findings, coverageGaps, failures };
  }
}

return {
  status: "incomplete",
  stopReason: "iteration-limit",
  iterations,
  findings,
  coverageGaps,
  review: lastReview,
  failures,
};
