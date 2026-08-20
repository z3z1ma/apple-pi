// Targeted review template: test one known question, then independently verify its candidates.
// Adapt the referenced prompts for this change and inline them; preserve their evidence and output contracts.
const READ_ONLY = ["read", "grep", "find", "ls"];
const REVIEWER = "<adapt references/reviewer.md for this question and inline it here>";
const VERIFIER = "<adapt references/verifier.md for this question and inline it here>";

const files = (inputs.paths || "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const contextFiles = (inputs.contextPaths || "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const checks = (inputs.checks || "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const question = (inputs.question || "").trim();
const background = (inputs.background || "").trim();
const compare = (inputs.compare || "HEAD").trim();
if (files.length === 0) throw new Error("inputs.paths is required (newline-separated repository paths)");
if (!question) throw new Error("inputs.question is required");
if (!compare) throw new Error("inputs.compare is required");

function statusSummary(status) {
  return status.entries.map((entry) => `${entry.index}${entry.worktree} ${entry.path}${entry.from ? ` <- ${entry.from}` : ""}`).join("\n");
}

function compactText(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function contextWithPatch(base, patchKey, truncatedKey, patch, maxPatchChars) {
  const fitted = std.context.fit(
    {
      ...base,
      [patchKey]: std.context.clippable(patch, {
        maxChars: maxPatchChars,
        strategy: "head-tail",
        marker: "\n\n[... patch clipped for worker context ...]\n\n",
      }),
      [truncatedKey]: false,
    },
    { maxSerializedChars: 47900 },
  );
  return { ...fitted.value, [truncatedKey]: fitted.truncated.includes(`$.${patchKey}`) };
}

const change = await std.git.change({ compare, paths: files });
const { untrackedFiles } = change;
const changeStatus = statusSummary(change.status);
const focus = {
  id: "targeted-focus",
  partitionId: "targeted-partition",
  partitionTitle: question,
  targetFiles: files,
  contextFiles,
  partitionRationale: background,
  title: question,
  priority: "high",
  question,
  checks,
  rationale: background,
};
const reviewContext = contextWithPatch(
  { focus, background, compare, untrackedFiles },
  "patch",
  "patchTruncated",
  change.patch,
  16000,
);

const review = await agents.run({
  name: focus.id,
  profile: "quick",
  tools: READ_ONLY,
  systemPrompt: REVIEWER,
  task: "Investigate the assigned partition focus and return the typed review result.",
  context: reviewContext,
  outputSchema: {
    type: "object",
    required: ["findings", "notes"],
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["title", "severity", "path", "trigger", "evidence", "impact", "recommendation"],
          properties: {
            title: { type: "string" },
            severity: { type: "string", enum: ["critical", "significant", "minor"] },
            path: { type: "string" },
            startLine: { type: "integer", minimum: 1 },
            endLine: { type: "integer", minimum: 1 },
            trigger: { type: "string" },
            evidence: { type: "string" },
            impact: { type: "string" },
            recommendation: { type: "string" },
          },
        },
      },
      notes: {
        type: "array",
        items: {
          type: "object",
          required: ["topic", "observation"],
          properties: {
            topic: { type: "string" },
            observation: { type: "string" },
          },
        },
      },
    },
  },
});

const findings = review.value?.findings ?? [];
const notes = review.value?.notes ?? [];
const candidates = findings.map((finding, index) => ({
  candidateId: `targeted-candidate-${index + 1}`,
  focusId: focus.id,
  scopeValid: files.includes(finding.path),
  ...finding,
}));
const failedFocuses = review.status === "completed" ? [] : [{ id: focus.id, error: review.error || "worker failed" }];
const verifierCandidates = std.context.pack(
  candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    focusId: candidate.focusId,
    scopeValid: candidate.scopeValid,
    title: compactText(candidate.title, 180),
    severity: candidate.severity,
    path: candidate.path,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    trigger: compactText(candidate.trigger, 500),
    evidence: compactText(candidate.evidence, 700),
    impact: compactText(candidate.impact, 400),
    recommendation: compactText(candidate.recommendation, 300),
  })),
  {
    maxSerializedChars: 12000,
    id: "candidateId",
    priority: (candidate) => (candidate.severity === "critical" ? 3 : candidate.severity === "significant" ? 2 : 1),
  },
);
const verifierNotes = std.context.pack(
  notes.map((note, index) => ({
    id: `targeted-focus-note-${index + 1}`,
    topic: compactText(note.topic, 160),
    observation: compactText(note.observation, 400),
  })),
  { maxSerializedChars: 8000, id: "id" },
);
const verifierContext = contextWithPatch(
  {
    files,
    untrackedFiles,
    background,
    compare,
    changeStatus,
    changeStat: change.stat,
    focusCoverage: [
      {
        id: focus.id,
        partitionId: focus.partitionId,
        partitionTitle: focus.partitionTitle,
        targetFiles: focus.targetFiles,
        question: focus.question,
        status: review.status,
        patchTruncated: reviewContext.patchTruncated,
      },
    ],
    candidates: verifierCandidates.items,
    candidateIdsOmitted: verifierCandidates.omittedIds,
    notes: verifierNotes.items,
    noteIdsOmitted: verifierNotes.omittedIds,
    notesOmitted: verifierNotes.omitted.length,
    failedFocuses,
    uncoveredFiles: [],
    truncatedFocuses: reviewContext.patchTruncated ? [focus.id] : [],
  },
  "verificationPatch",
  "verificationPatchTruncated",
  change.patch,
  8000,
);

const meta = await agent({
  name: "review-verifier",
  profile: "balanced",
  tools: READ_ONLY,
  systemPrompt: VERIFIER,
  task: "Verify every candidate and assess the review coverage. Return the typed verdict.",
  context: verifierContext,
  outputSchema: {
    type: "object",
    required: ["decisions", "summary", "compoundRisks", "residualRisks", "coverageGaps"],
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          required: ["candidateId", "title", "path", "status", "reason"],
          properties: {
            candidateId: { type: "string" },
            title: { type: "string" },
            path: { type: "string" },
            startLine: { type: "integer", minimum: 1 },
            status: { type: "string", enum: ["confirmed", "rejected", "unresolved", "duplicate"] },
            severity: { type: "string", enum: ["critical", "significant", "minor"] },
            duplicateOf: { type: "string" },
            trigger: { type: "string" },
            evidence: { type: "string" },
            impact: { type: "string" },
            recommendation: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      summary: { type: "string" },
      compoundRisks: { type: "array", items: { type: "string" } },
      residualRisks: { type: "array", items: { type: "string" } },
      coverageGaps: { type: "array", items: { type: "string" } },
    },
  },
});

const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
const normalizedDecisions = meta.decisions.map((decision) => ({
  ...candidateById.get(decision.candidateId),
  ...decision,
}));
const normalizedMeta = { ...meta, decisions: normalizedDecisions };
const decidedIds = new Set(normalizedDecisions.map((decision) => decision.candidateId));
const unknownDecisionIds = normalizedDecisions
  .filter((decision) => !candidateById.has(decision.candidateId))
  .map((decision) => decision.candidateId);
const undecidedCandidates = candidates.filter((candidate) => !decidedIds.has(candidate.candidateId));

return {
  scope: { files: files.length, compare, question },
  status: review.status,
  candidates: candidates.length,
  failedFocuses,
  patchTruncated: reviewContext.patchTruncated,
  verificationPatchTruncated: verifierContext.verificationPatchTruncated,
  unknownDecisionIds,
  undecidedCandidates,
  candidateIdsOmitted: verifierCandidates.omittedIds,
  noteIdsOmitted: verifierNotes.omittedIds,
  meta: normalizedMeta,
};
