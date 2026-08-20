// Security-boundary template: two independent attack/defense baselines over the same patch,
// followed by a deep verifier. Adapt both prompt templates and their threat model before inlining.
const READ_ONLY = ["read", "grep", "find", "ls"];
const ATTACKER = "<adapt references/reviewer.md as an attacker model for this boundary and inline it here>";
const DEFENDER = "<adapt references/reviewer.md as a defensive-control model for this boundary and inline it here>";
const VERIFIER = "<adapt references/verifier.md for this security boundary and inline it here>";

const files = (inputs.paths || "")
  .split("\n")
  .map((path) => path.trim())
  .filter(Boolean);
const background = (inputs.background || "").trim();
const boundary = (inputs.boundary || "").trim();
const compare = (inputs.compare || "HEAD").trim();
if (files.length === 0 || !boundary) throw new Error("inputs.paths and inputs.boundary are required");
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
const { patch, untrackedFiles } = change;
const status = statusSummary(change.status);
const baselineContext = contextWithPatch(
  { files, compare, background, status, untrackedFiles },
  "patch",
  "patchTruncated",
  patch,
  16000,
);
const reviewSchema = {
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
const baselines = [
  {
    id: "attacker-baseline",
    prompt: ATTACKER,
    question: `Can an untrusted actor cross, bypass, or confuse the ${boundary} boundary after this change?`,
  },
  {
    id: "defender-baseline",
    prompt: DEFENDER,
    question: `Do the ${boundary} boundary's authorization, validation, and audit controls still hold on every changed path?`,
  },
];
const reviews = await parallel(
  baselines,
  async (baseline) => {
    const result = await agents.run({
      name: baseline.id,
      profile: "balanced",
      tools: READ_ONLY,
      systemPrompt: baseline.prompt,
      task: "Review the security boundary from the assigned independent baseline.",
      context: {
        ...baselineContext,
        focus: {
          id: baseline.id,
          title: baseline.id,
          question: baseline.question,
          targetFiles: files,
          checks: ["Trace trust origin, effective authorization, validation, and externally observable effects."],
        },
      },
      outputSchema: reviewSchema,
    });
    return {
      ...baseline,
      status: result.status,
      findings: result.value?.findings ?? [],
      notes: result.value?.notes ?? [],
      error: result.error,
    };
  },
  2,
);
const candidates = reviews.flatMap((review) =>
  review.findings.map((finding, index) => ({
    candidateId: `${review.id}-${index + 1}`,
    focusId: review.id,
    scopeValid: files.includes(finding.path),
    ...finding,
  })),
);
const failedFocuses = reviews
  .filter((review) => review.status !== "completed")
  .map((review) => ({ id: review.id, error: review.error || "worker failed" }));
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
  reviews.flatMap((review) =>
    review.notes.map((note, index) => ({
      id: `${review.id}-note-${index + 1}`,
      focusId: review.id,
      topic: compactText(note.topic, 160),
      observation: compactText(note.observation, 400),
    })),
  ),
  { maxSerializedChars: 8000 },
);
const verifierContext = contextWithPatch(
  {
    files,
    compare,
    background,
    status,
    untrackedFiles,
    focusCoverage: reviews.map((review) => ({
      id: review.id,
      targetFiles: files,
      question: review.question,
      status: review.status,
      patchTruncated: baselineContext.patchTruncated,
    })),
    candidates: verifierCandidates.items,
    candidateIdsOmitted: verifierCandidates.omittedIds,
    notes: verifierNotes.items,
    notesOmitted: verifierNotes.omitted.length,
    failedFocuses,
    uncoveredFiles: [],
    truncatedFocuses: baselineContext.patchTruncated ? baselines.map((baseline) => baseline.id) : [],
  },
  "verificationPatch",
  "verificationPatchTruncated",
  patch,
  8000,
);
const meta = await agent({
  name: "security-verifier",
  profile: "deep",
  tools: READ_ONLY,
  systemPrompt: VERIFIER,
  task: "Independently verify every security candidate and identify gaps between the attacker and defender baselines.",
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
const unknownDecisionIds = decisions
  .filter((decision) => !candidateById.has(decision.candidateId))
  .map((decision) => decision.candidateId);
return {
  scope: { files: files.length, boundary, compare },
  candidates: candidates.length,
  failedFocuses,
  patchTruncated: baselineContext.patchTruncated,
  verificationPatchTruncated: verifierContext.verificationPatchTruncated,
  unknownDecisionIds,
  undecidedCandidates: candidates.filter((candidate) => !decidedIds.has(candidate.candidateId)),
  meta: { ...meta, decisions },
};
