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

const change = await std.git.change({ compare, paths: files });
const { patch, untrackedFiles } = change;
const reviewContext = std.context.fit(
  { ...{ files, compare, background, untrackedFiles }, ["patch"]: std.context.clippable(patch, { maxChars: 16000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
  { flags: { ["patchTruncated"]: `$.${"patch"}` } },
).value;
const findingSchema = std.schema({"findings":[{"title":"string","severity":["critical","significant","minor"],"path":"string","startLine?":{"int":{"minimum":1}},"endLine?":{"int":{"minimum":1}},"trigger":"string","evidence":"string","impact":"string","recommendation":"string"}],"notes":[{"topic":"string","observation":"string"}]});
const verdictSchema = std.schema({"decisions":[{"candidateId":"string","title":"string","path":"string","startLine?":{"int":{"minimum":1}},"status":["confirmed","rejected","unresolved","duplicate"],"severity?":["critical","significant","minor"],"duplicateOf?":"string","trigger?":"string","evidence?":"string","impact?":"string","recommendation?":"string","reason":"string"}],"summary":"string","compoundRisks":["string"],"residualRisks":["string"],"coverageGaps":["string"]});
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
    evidence: candidate.evidence,
    trigger: candidate.trigger,
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
const triageNotes = std.context.pack(
  initial.notes.map((note, index) => ({
    id: `initial-review-note-${index + 1}`,
    topic: note.topic,
    observation: note.observation,
  })),
  { fields: { title: 180, trigger: 500, evidence: 700, impact: 400, recommendation: 300, topic: 160, observation: 400, message: 700, reason: 300 }, maxSerializedChars: 8000 },
);
const triage = await agent({
  name: "coverage-triage",
  profile: "balanced",
  tools: READ_ONLY,
  systemPrompt: TRIAGE_VERIFIER,
  task: "Verify initial candidates and identify only material residual coverage gaps that need a second focused pass.",
  context: std.context.fit(
  { ...{
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
    }, ["verificationPatch"]: std.context.clippable(patch, { maxChars: 8000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
  { flags: { ["verificationPatchTruncated"]: `$.${"verificationPatch"}` } },
).value,
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
    evidence: candidate.evidence,
    trigger: candidate.trigger,
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
const finalNotes = std.context.pack(
  allReviews.flatMap((review) =>
    review.notes.map((note, index) => ({
      id: `${review.id}-note-${index + 1}`,
      focusId: review.id,
      topic: note.topic,
      observation: note.observation,
    })),
  ),
  { fields: { title: 180, trigger: 500, evidence: 700, impact: 400, recommendation: 300, topic: 160, observation: 400, message: 700, reason: 300 }, maxSerializedChars: 8000 },
);
const finalContext = std.context.fit(
  { ...{
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
  }, ["verificationPatch"]: std.context.clippable(patch, { maxChars: 8000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
  { flags: { ["verificationPatchTruncated"]: `$.${"verificationPatch"}` } },
).value;
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
