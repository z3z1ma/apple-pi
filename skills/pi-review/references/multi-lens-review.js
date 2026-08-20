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
const rawPatch = change.patch;
const changeStatus = statusSummary(change.status);
const { untrackedFiles } = change;
const reviewPatch = contextWithPatch(
  { files, contextFiles, background, compare, untrackedFiles },
  "patch",
  "patchTruncated",
  rawPatch,
  16000,
);

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
              properties: { topic: { type: "string" }, observation: { type: "string" } },
            },
          },
        },
      },
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
    title: compactText(candidate.title, 180),
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
  reviews.flatMap((review) => review.notes.map((note, index) => ({ id: `${review.lens.id}-note-${index + 1}`, focusId: review.lens.id, topic: compactText(note.topic, 160), observation: compactText(note.observation, 400) }))),
  { maxSerializedChars: 8000 },
);
const verifierContext = contextWithPatch(
  {
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
  },
  "verificationPatch",
  "verificationPatchTruncated",
  rawPatch,
  8000,
);

const meta = await agent({
  name: "review-verifier",
  profile: "deep",
  tools: READ_ONLY,
  systemPrompt: VERIFIER,
  task: "Independently verify every candidate, deduplicate lenses, and assess high-risk review coverage.",
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
