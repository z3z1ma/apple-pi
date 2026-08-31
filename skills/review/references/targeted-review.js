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




const change = await std.git.change({ compare, paths: files });
const { untrackedFiles } = change;
const changeStatus = change.statusText;
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
const reviewContext = std.context.fit(
  { ...{ focus, background, compare, untrackedFiles }, ["patch"]: std.context.clippable(change.patch, { maxChars: 16000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
  { flags: { ["patchTruncated"]: `$.${"patch"}` } },
).value;

const review = await agent.run({
  name: focus.id,
  profile: "quick",
  tools: READ_ONLY,
  systemPrompt: REVIEWER,
  task: "Investigate the assigned partition focus and return the typed review result.",
  context: reviewContext,
  outputSchema: std.schema({"findings":[{"title":"string","severity":["critical","significant","minor"],"path":"string","startLine?":{"int":{"minimum":1}},"endLine?":{"int":{"minimum":1}},"trigger":"string","evidence":"string","impact":"string","recommendation":"string"}],"notes":[{"topic":"string","observation":"string"}]}),
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
    id: `targeted-focus-note-${index + 1}`,
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
  }, ["verificationPatch"]: std.context.clippable(change.patch, { maxChars: 8000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
  { flags: { ["verificationPatchTruncated"]: `$.${"verificationPatch"}` } },
).value;

const meta = await agent({
  name: "review-verifier",
  profile: "balanced",
  tools: READ_ONLY,
  systemPrompt: VERIFIER,
  task: "Verify every candidate and assess the review coverage. Return the typed verdict.",
  context: verifierContext,
  outputSchema: std.schema({"decisions":[{"candidateId":"string","title":"string","path":"string","startLine?":{"int":{"minimum":1}},"status":["confirmed","rejected","unresolved","duplicate"],"severity?":["critical","significant","minor"],"duplicateOf?":"string","trigger?":"string","evidence?":"string","impact?":"string","recommendation?":"string","reason":"string"}],"summary":"string","compoundRisks":["string"],"residualRisks":["string"],"coverageGaps":["string"]}),
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
