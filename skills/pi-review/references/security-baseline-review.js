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

function quote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

async function git(command) {
  const result = await pi.bash({ command });
  if (!result.ok) throw new Error(result.output || command);
  return result.output;
}
function compactText(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}
function fitForContext(items, mapper, maxChars) {
  const kept = [];
  let size = 2;
  for (const item of items) {
    const compact = mapper(item);
    const compactSize = JSON.stringify(compact).length + (kept.length > 0 ? 1 : 0);
    if (size + compactSize > maxChars) break;
    kept.push(compact);
    size += compactSize;
  }
  return {
    items: kept,
    omittedCount: items.length - kept.length,
    omittedIds: items
      .slice(kept.length)
      .map((item) => item.candidateId)
      .filter(Boolean),
  };
}
function contextWithPatch(base, patchKey, truncatedKey, patch, maxPatchChars) {
  let low = 0;
  let high = Math.min(maxPatchChars, patch.length);
  let best;
  while (low <= high) {
    const limit = Math.floor((low + high) / 2);
    const clipped =
      limit <= 0
        ? { text: "", truncated: patch.length > 0 }
        : patch.length <= limit
          ? { text: patch, truncated: false }
          : {
              text: `${patch.slice(0, Math.floor(limit / 2))}\n\n[... patch clipped for worker context ...]\n\n${patch.slice(-Math.floor(limit / 2))}`,
              truncated: true,
            };
    const candidate = { ...base, [patchKey]: clipped.text, [truncatedKey]: clipped.truncated };
    if (JSON.stringify(candidate).length <= 48000) {
      best = candidate;
      low = limit + 1;
    } else {
      high = limit - 1;
    }
  }
  if (!best) throw new Error("Review context exceeds the worker context limit before adding a patch");
  return best;
}

const pathArgs = files.map(quote).join(" ");
const [patch, status, rawUntrackedFiles] = await Promise.all([
  git(`git diff --no-ext-diff --unified=3 ${quote(compare)} -- ${pathArgs}`),
  git(`git status --short --untracked-files=all -- ${pathArgs}`),
  git(`git ls-files --others --exclude-standard -z -- ${pathArgs}`),
]);
const untrackedFiles = rawUntrackedFiles.split("\0").filter(Boolean);
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
const verifierCandidates = fitForContext(
  candidates,
  (candidate) => ({
    ...candidate,
    title: compactText(candidate.title, 180),
    trigger: compactText(candidate.trigger, 500),
    evidence: compactText(candidate.evidence, 700),
    impact: compactText(candidate.impact, 400),
    recommendation: compactText(candidate.recommendation, 300),
  }),
  12000,
);
const verifierNotes = fitForContext(
  reviews.flatMap((review) => review.notes.map((note) => ({ focusId: review.id, ...note }))),
  (note) => ({
    focusId: note.focusId,
    topic: compactText(note.topic, 160),
    observation: compactText(note.observation, 400),
  }),
  8000,
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
    notesOmitted: verifierNotes.omittedCount,
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
