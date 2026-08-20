// Residual-loop template: review a known contract, use a balanced verifier to expose coverage gaps,
// investigate only those gaps, then let a deep verifier make the final independent decisions.
// Adapt the prompt templates and the residual selection rule for this change before inlining.
const READ_ONLY = ["read", "grep", "find", "ls"];
const REVIEWER = "<adapt references/reviewer.md for the initial and residual passes and inline it here>";
const TRIAGE_VERIFIER =
  "<adapt references/verifier.md to identify material residual coverage gaps and inline it here>";
const FINAL_VERIFIER = "<adapt references/verifier.md for final independent verification and inline it here>";

const files = (inputs.paths || "")
  .split("\n")
  .map((path) => path.trim())
  .filter(Boolean);
const question = (inputs.question || "").trim();
const background = (inputs.background || "").trim();
const compare = (inputs.compare || "HEAD").trim();
if (files.length === 0 || !question) throw new Error("inputs.paths and inputs.question are required");
if (!compare) throw new Error("inputs.compare is required");

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
const { patch, untrackedFiles } = change;
const reviewContext = contextWithPatch(
  { files, compare, background, untrackedFiles },
  "patch",
  "patchTruncated",
  patch,
  16000,
);
const findingSchema = {
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
        properties: { topic: { type: "string" }, observation: { type: "string" } },
      },
    },
  },
};
const verdictSchema = {
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
};
const initialFocus = {
  id: "initial",
  title: question,
  question,
  targetFiles: files,
  checks: ["Trace the stated contract and all changed error, cleanup, and compatibility branches."],
  rationale: background,
};
async function investigate(id, focus) {
  const result = await agents.run({
    name: id,
    profile: "quick",
    tools: READ_ONLY,
    systemPrompt: REVIEWER,
    task: "Investigate the assigned review focus and return the typed review result.",
    context: { ...reviewContext, focus },
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
}
function candidatesFor(review) {
  return review.findings.map((finding, index) => ({
    candidateId: `${review.id}-${index + 1}`,
    focusId: review.id,
    scopeValid: files.includes(finding.path),
    ...finding,
  }));
}
const initial = await investigate("initial-review", initialFocus);
const initialCandidates = candidatesFor(initial);
const triageCandidates = std.context.pack(
  initialCandidates.map((candidate) => ({
    ...candidate,
    evidence: compactText(candidate.evidence, 700),
    trigger: compactText(candidate.trigger, 500),
    impact: compactText(candidate.impact, 400),
    recommendation: compactText(candidate.recommendation, 300),
  })),
  {
    maxSerializedChars: 12000,
    id: "candidateId",
    priority: (candidate) => (candidate.severity === "critical" ? 3 : candidate.severity === "significant" ? 2 : 1),
  },
);
const triageNotes = std.context.pack(
  initial.notes.map((note, index) => ({
    id: `initial-review-note-${index + 1}`,
    topic: compactText(note.topic, 160),
    observation: compactText(note.observation, 400),
  })),
  { maxSerializedChars: 8000 },
);
const triage = await agent({
  name: "coverage-triage",
  profile: "balanced",
  tools: READ_ONLY,
  systemPrompt: TRIAGE_VERIFIER,
  task: "Verify initial candidates and identify only material residual coverage gaps that need a second focused pass.",
  context: contextWithPatch(
    {
      files,
      compare,
      background,
      untrackedFiles,
      focusCoverage: [
        {
          id: initial.id,
          targetFiles: files,
          question,
          status: initial.status,
          patchTruncated: reviewContext.patchTruncated,
        },
      ],
      candidates: triageCandidates.items,
      candidateIdsOmitted: triageCandidates.omittedIds,
      notes: triageNotes.items,
      notesOmitted: triageNotes.omitted.length,
      failedFocuses:
        initial.status === "completed" ? [] : [{ id: initial.id, error: initial.error || "worker failed" }],
      uncoveredFiles: [],
      truncatedFocuses: reviewContext.patchTruncated ? [initial.id] : [],
    },
    "verificationPatch",
    "verificationPatchTruncated",
    patch,
    8000,
  ),
  outputSchema: verdictSchema,
});
const residualQuestions = triage.coverageGaps || [];
const attemptedCoverageGaps = residualQuestions.slice(0, 3);
const deferredCoverageGaps = residualQuestions.slice(3);
const residuals = await parallel(
  attemptedCoverageGaps,
  (gap, index) =>
    investigate(`residual-${index + 1}`, {
      id: `residual-${index + 1}`,
      title: "Residual coverage",
      question: gap,
      targetFiles: files,
      checks: ["Investigate this verifier-identified gap without re-running the whole review."],
      rationale: "Coverage gap from the first verification pass.",
    }),
  3,
);
const allReviews = [initial, ...residuals];
const candidates = allReviews.flatMap(candidatesFor);
const failedFocuses = allReviews
  .filter((review) => review.status !== "completed")
  .map((review) => ({ id: review.id, error: review.error || "worker failed" }));
const finalCandidates = std.context.pack(
  candidates.map((candidate) => ({
    ...candidate,
    evidence: compactText(candidate.evidence, 700),
    trigger: compactText(candidate.trigger, 500),
    impact: compactText(candidate.impact, 400),
    recommendation: compactText(candidate.recommendation, 300),
  })),
  {
    maxSerializedChars: 12000,
    id: "candidateId",
    priority: (candidate) => (candidate.severity === "critical" ? 3 : candidate.severity === "significant" ? 2 : 1),
  },
);
const finalNotes = std.context.pack(
  allReviews.flatMap((review) =>
    review.notes.map((note, index) => ({
      id: `${review.id}-note-${index + 1}`,
      focusId: review.id,
      topic: compactText(note.topic, 160),
      observation: compactText(note.observation, 400),
    })),
  ),
  { maxSerializedChars: 8000 },
);
const finalContext = contextWithPatch(
  {
    files,
    compare,
    background,
    untrackedFiles,
    focusCoverage: allReviews.map((review) => ({
      id: review.id,
      targetFiles: files,
      question: review.focus.question,
      status: review.status,
      patchTruncated: reviewContext.patchTruncated,
    })),
    candidates: finalCandidates.items,
    candidateIdsOmitted: finalCandidates.omittedIds,
    notes: finalNotes.items,
    notesOmitted: finalNotes.omitted.length,
    failedFocuses,
    uncoveredFiles: [],
    truncatedFocuses: reviewContext.patchTruncated ? allReviews.map((review) => review.id) : [],
    initialCoverageGaps: attemptedCoverageGaps,
    deferredCoverageGaps,
  },
  "verificationPatch",
  "verificationPatchTruncated",
  patch,
  8000,
);
const meta = await agent({
  name: "final-review-verifier",
  profile: "deep",
  tools: READ_ONLY,
  systemPrompt: FINAL_VERIFIER,
  task: "Independently verify every candidate after the residual pass and assess final coverage.",
  context: finalContext,
  outputSchema: verdictSchema,
});
const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
const decisions = meta.decisions.map((decision) => ({ ...candidateById.get(decision.candidateId), ...decision }));
const decidedIds = new Set(decisions.map((decision) => decision.candidateId));
const unknownDecisionIds = decisions
  .filter((decision) => !candidateById.has(decision.candidateId))
  .map((decision) => decision.candidateId);
return {
  scope: { files: files.length, question, compare },
  initialCandidates: initialCandidates.length,
  residualPasses: residuals.length,
  attemptedCoverageGaps,
  deferredCoverageGaps,
  failedFocuses,
  patchTruncated: reviewContext.patchTruncated,
  verificationPatchTruncated: finalContext.verificationPatchTruncated,
  unknownDecisionIds,
  undecidedCandidates: candidates.filter((candidate) => !decidedIds.has(candidate.candidateId)),
  meta: { ...meta, decisions },
};
