// High-risk multi-lens template: independently test several known contracts over one change,
// then use a deep verifier to reconcile overlapping candidates and coverage.
// Adapt the referenced prompts and lens questions for this change; preserve evidence and output contracts.
const READ_ONLY = ["read", "grep", "find", "ls"];
const REVIEWER = "<adapt references/reviewer.md for each lens and inline it here>";
const VERIFIER = "<adapt references/verifier.md for a high-risk multi-lens review and inline it here>";

const files = (inputs.paths || "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const contextFiles = (inputs.contextPaths || "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const lenses = (inputs.lenses || "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    const [title, question] = line.split("|").map((part) => part.trim());
    if (!title || !question) throw new Error(`inputs.lenses line ${index + 1} must be: title | falsifiable question`);
    return { id: `lens-${index + 1}`, title, question };
  });
const background = (inputs.background || "").trim();
const compare = (inputs.compare || "HEAD").trim();
if (files.length === 0) throw new Error("inputs.paths is required (newline-separated repository paths)");
if (lenses.length < 2) throw new Error("inputs.lenses requires at least two independently useful lenses");
if (!compare) throw new Error("inputs.compare is required");




const change = await std.git.change({ compare, paths: files });
const rawPatch = change.patch;
const changeStatus = change.statusText;
const { untrackedFiles } = change;
const reviewPatch = std.context.fit(
  { ...{ files, contextFiles, background, compare, untrackedFiles }, ["patch"]: std.context.clippable(rawPatch, { maxChars: 16000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
  { flags: { ["patchTruncated"]: `$.${"patch"}` } },
).value;

const reviews = await parallel(
  lenses,
  async (lens) => {
    const focus = {
      ...lens,
      partitionId: "multi-lens-partition",
      partitionTitle: "High-risk change",
      targetFiles: files,
      contextFiles,
      priority: "high",
      checks: ["Trace the assigned contract through its producers, consumers, guards, and tests."],
      rationale: background,
    };
    const result = await agents.run({
      name: lens.id,
      profile: "quick",
      tools: READ_ONLY,
      systemPrompt: REVIEWER,
      task: "Investigate this independent high-risk review lens and return the typed review result.",
      context: { ...reviewPatch, focus },
      outputSchema: std.schema({"findings":[{"title":"string","severity":["critical","significant","minor"],"path":"string","startLine?":{"int":{"minimum":1}},"endLine?":{"int":{"minimum":1}},"trigger":"string","evidence":"string","impact":"string","recommendation":"string"}],"notes":[{"topic":"string","observation":"string"}]}),
    });
    return {
      lens,
      status: result.status,
      findings: result.value?.findings ?? [],
      notes: result.value?.notes ?? [],
      error: result.error,
    };
  },
  Math.min(lenses.length, 6),
);

const candidates = reviews.flatMap((review) =>
  review.findings.map((finding, index) => ({
    candidateId: `${review.lens.id}-candidate-${index + 1}`,
    focusId: review.lens.id,
    scopeValid: files.includes(finding.path),
    ...finding,
  })),
);
const failedFocuses = reviews
  .filter((review) => review.status !== "completed")
  .map((review) => ({ id: review.lens.id, error: review.error || "worker failed" }));
const focusCoverage = reviews.map((review) => ({
  id: review.lens.id,
  partitionId: "multi-lens-partition",
  partitionTitle: "High-risk change",
  targetFiles: files,
  question: review.lens.question,
  status: review.status,
  patchTruncated: reviewPatch.patchTruncated,
}));
const verifierCandidates = std.context.pack(
  candidates.map((candidate) => ({
    ...candidate,
    title: candidate.title,
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
  reviews.flatMap((review) => review.notes.map((note, index) => ({ id: `${review.lens.id}-note-${index + 1}`, focusId: review.lens.id, topic: note.topic, observation: note.observation }))),
  { fields: { title: 180, trigger: 500, evidence: 700, impact: 400, recommendation: 300, topic: 160, observation: 400, message: 700, reason: 300 }, maxSerializedChars: 8000 },
);
const verifierContext = std.context.fit(
  { ...{
    files,
    untrackedFiles,
    background,
    compare,
    changeStatus,
    changeStat: change.stat,
    focusCoverage,
    candidates: verifierCandidates.items,
    candidateIdsOmitted: verifierCandidates.omittedIds,
    notes: verifierNotes.items,
    notesOmitted: verifierNotes.omitted.length,
    failedFocuses,
    uncoveredFiles: [],
    truncatedFocuses: reviewPatch.patchTruncated ? lenses.map((lens) => lens.id) : [],
  }, ["verificationPatch"]: std.context.clippable(rawPatch, { maxChars: 8000, strategy: "head-tail", marker: "\n\n[... patch clipped for worker context ...]\n\n" }) },
  { flags: { ["verificationPatchTruncated"]: `$.${"verificationPatch"}` } },
).value;

const meta = await agent({
  name: "review-verifier",
  profile: "deep",
  tools: READ_ONLY,
  systemPrompt: VERIFIER,
  task: "Independently verify every candidate, deduplicate lenses, and assess high-risk review coverage.",
  context: verifierContext,
  outputSchema: std.schema({"decisions":[{"candidateId":"string","title":"string","path":"string","startLine?":{"int":{"minimum":1}},"status":["confirmed","rejected","unresolved","duplicate"],"severity?":["critical","significant","minor"],"duplicateOf?":"string","trigger?":"string","evidence?":"string","impact?":"string","recommendation?":"string","reason":"string"}],"summary":"string","compoundRisks":["string"],"residualRisks":["string"],"coverageGaps":["string"]}),
});

const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
const decisions = meta.decisions.map((decision) => ({ ...candidateById.get(decision.candidateId), ...decision }));
const decidedIds = new Set(decisions.map((decision) => decision.candidateId));
return {
  scope: { files: files.length, lenses: lenses.length, compare },
  candidates: candidates.length,
  failedFocuses,
  patchTruncated: reviewPatch.patchTruncated,
  verificationPatchTruncated: verifierContext.verificationPatchTruncated,
  undecidedCandidates: candidates.filter((candidate) => !decidedIds.has(candidate.candidateId)),
  meta: { ...meta, decisions },
};
