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

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

async function gitOutput(command) {
  const result = await pi.bash({ command });
  if (!result.ok) throw new Error(result.output || `Git command failed: ${command}`);
  return result.output;
}

function compactText(value, limit) {
  const text = String(value || "");
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function clipPatch(patch, limit) {
  if (patch.length <= limit) return { text: patch, truncated: false };
  if (limit <= 0) return { text: "", truncated: patch.length > 0 };
  const half = Math.floor(limit / 2);
  return {
    text: `${patch.slice(0, half)}\n\n[... patch clipped for worker context ...]\n\n${patch.slice(-half)}`,
    truncated: true,
  };
}

function contextWithPatch(base, patchKey, truncatedKey, patch, maxPatchChars) {
  let low = 0;
  let high = Math.min(maxPatchChars, patch.length);
  let best;
  while (low <= high) {
    const limit = Math.floor((low + high) / 2);
    const clipped = clipPatch(patch, limit);
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

async function patchFor(paths) {
  const pathArgs = paths.map(shellQuote).join(" ");
  return gitOutput(`git diff --no-ext-diff --unified=3 ${shellQuote(compare)} -- ${pathArgs}`);
}

const allPathArgs = files.map(shellQuote).join(" ");
const [changeStatus, changeStat, rawPlanningPatch, rawUntrackedFiles] = await Promise.all([
  gitOutput(`git status --short --untracked-files=all -- ${allPathArgs}`),
  gitOutput(`git diff --no-ext-diff --stat ${shellQuote(compare)} -- ${allPathArgs}`),
  patchFor(files),
  gitOutput(`git ls-files --others --exclude-standard -z -- ${allPathArgs}`),
]);
const untrackedFiles = rawUntrackedFiles.split("\0").filter(Boolean);
const planningContext = contextWithPatch(
  { files, untrackedFiles, background, compare, changeStatus, changeStat },
  "changePatch",
  "changePatchTruncated",
  rawPlanningPatch,
  12000,
);

const plan = await agent({
  name: "review-planner",
  profile: "balanced",
  tools: READ_ONLY,
  systemPrompt: PLANNER,
  task: "Partition the change and define focused investigations. Return the typed plan.",
  context: planningContext,
  outputSchema: {
    type: "object",
    required: ["summary", "partitions"],
    properties: {
      summary: { type: "string" },
      partitions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["title", "files", "contextFiles", "rationale", "focuses"],
          properties: {
            title: { type: "string" },
            files: { type: "array", minItems: 1, items: { type: "string" } },
            contextFiles: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
            focuses: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["title", "priority", "question", "checks", "rationale"],
                properties: {
                  title: { type: "string" },
                  priority: { type: "string", enum: ["high", "medium", "low"] },
                  question: { type: "string" },
                  checks: { type: "array", minItems: 1, items: { type: "string" } },
                  rationale: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
});

const selectedPaths = new Set(files);
const partitions = plan.partitions.map((partition, partitionIndex) => {
  const outsideScope = partition.files.filter((path) => !selectedPaths.has(path));
  if (outsideScope.length > 0) {
    throw new Error(`Planner assigned non-selected changed paths: ${outsideScope.join(", ")}`);
  }
  return { id: `partition-${partitionIndex + 1}`, ...partition };
});
const assignedPaths = new Set(partitions.flatMap((partition) => partition.files));
const uncoveredFiles = files.filter((path) => !assignedPaths.has(path));
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
      const rawPatch = await patchFor(focus.targetFiles);
      reviewContext = contextWithPatch(
        {
          focus,
          background,
          compare,
          untrackedFiles: untrackedFiles.filter((path) => focus.targetFiles.includes(path)),
        },
        "patch",
        "patchTruncated",
        rawPatch,
        16000,
      );
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
if (candidatePaths.length > 0) rawVerificationPatch = await patchFor(candidatePaths);
const verifierCandidates = candidates.map((candidate) => ({
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
}));
const verifierNotes = notes.slice(0, 64).map((note) => ({
  focusId: note.focusId,
  topic: compactText(note.topic, 160),
  observation: compactText(note.observation, 400),
}));
const verifierContext = contextWithPatch(
  {
    files,
    untrackedFiles,
    background,
    compare,
    changeStatus,
    changeStat,
    planSummary: plan.summary,
    focusCoverage,
    candidates: verifierCandidates,
    notes: verifierNotes,
    notesOmitted: notes.length - verifierNotes.length,
    failedFocuses,
    uncoveredFiles,
    truncatedFocuses,
    planningPatchTruncated: planningContext.changePatchTruncated,
  },
  "verificationPatch",
  "verificationPatchTruncated",
  rawVerificationPatch,
  8000,
);

const meta = await agent({
  name: "review-verifier",
  profile: "deep",
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
  scope: { files: files.length, compare },
  plan: { summary: plan.summary, partitions: partitions.length, focuses: focuses.length },
  candidates: candidates.length,
  failedFocuses,
  uncoveredFiles,
  truncatedFocuses,
  planningPatchTruncated: planningContext.changePatchTruncated,
  verificationPatchTruncated: verifierContext.verificationPatchTruncated,
  unknownDecisionIds,
  undecidedCandidates,
  meta: normalizedMeta,
};
