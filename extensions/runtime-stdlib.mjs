/**
 * Frozen guest standard library. This source is evaluated inside the pi_exec VM
 * after the explicit Pi bridges are installed; it has no ambient host authority.
 */
export const STDLIB_SETUP_SOURCE = String.raw`
  const stdAgent = agent;
  const stdRunAgent = agents.run;
  const stdParallel = parallel;
  const stdPi = pi;
  let nextEvidenceId = 1;

  const fail = (message) => { throw new TypeError(message); };
  const requireArray = (value, name) => { if (!Array.isArray(value)) fail(name + " expects an array"); };
  const requireObject = (value, name) => { if (!value || typeof value !== "object" || Array.isArray(value)) fail(name + " expects an object"); };
  const requirePositiveInteger = (value, name) => { if (!Number.isInteger(value) || value < 1) fail(name + " expects a positive integer"); };
  const asArray = (value) => Array.isArray(value) ? value : [];
  const unique = (values) => [...new Set(values)];
  const json = (value, name = "value") => {
    try {
      const result = JSON.stringify(value);
      if (result === undefined) throw new Error("undefined");
      return result;
    } catch (error) {
      throw new TypeError(name + " must be JSON-serializable: " + (error instanceof Error ? error.message : String(error)));
    }
  };
  const measure = (value) => json(value).length;
  const idFor = (value, key) => {
    if (typeof key === "function") return key(value);
    if (typeof key === "string") return value && typeof value === "object" ? value[key] : undefined;
    return value;
  };
  const orderedIds = (values, key) => values.map((value) => idFor(value, key));
  const assertUniqueIds = (values, key, name) => {
    const ids = orderedIds(values, key);
    if (ids.some((id) => id === undefined || id === null || id === "")) fail(name + " contains an item without an id");
    return ids;
  };

  const shellQuote = (value) => "'" + String(value).replaceAll("'", "'\\\"'\\\"'") + "'";
  const shellArgs = (values) => values.map(shellQuote).join(" ");
  const shellRun = (command, options = {}) => stdPi.bash({ command, ...(options.timeout === undefined ? {} : { timeout: options.timeout }) });
  const shellOutput = async (command, options) => {
    const result = await shellRun(command, options);
    if (!result.ok) throw new Error(result.output || "shell command failed");
    return result.output;
  };

  const gitOutput = (args) => shellOutput("git " + shellArgs(args));
  const gitPaths = (paths) => paths && paths.length ? ["--", ...paths] : [];
  const parseNameStatus = (output) => {
    const fields = output.split("\0").filter(Boolean);
    const entries = [];
    for (let index = 0; index < fields.length;) {
      const status = fields[index++];
      const code = status.slice(0, 1);
      if (code === "R" || code === "C") {
        const from = fields[index++];
        const path = fields[index++];
        if (from !== undefined && path !== undefined) entries.push({ status, code, path, from });
      } else {
        const path = fields[index++];
        if (path !== undefined) entries.push({ status, code, path });
      }
    }
    return entries;
  };
  const gitNameStatus = async (options = {}) => parseNameStatus(await gitOutput(["diff", "--no-ext-diff", "--name-status", "-z", options.compare || "HEAD", ...gitPaths(options.paths)]));
  const gitUntrackedFiles = async (options = {}) => (await gitOutput(["ls-files", "--others", "--exclude-standard", "-z", ...gitPaths(options.paths)])).split("\0").filter(Boolean);
  const gitStatus = async (options = {}) => {
    const fields = (await gitOutput(["status", "--porcelain=v1", "-z", "--untracked-files=all", ...gitPaths(options.paths)])).split("\0").filter(Boolean);
    const entries = [];
    for (let index = 0; index < fields.length; index++) {
      const field = fields[index];
      const xy = field.slice(0, 2);
      const entry = { index: xy[0], worktree: xy[1], path: field.slice(3), untracked: xy === "??" };
      if ((xy[0] === "R" || xy[1] === "R" || xy[0] === "C" || xy[1] === "C") && fields[index + 1] !== undefined) entry.from = fields[++index];
      entries.push(entry);
    }
    return { entries, dirty: entries.length > 0, untrackedFiles: entries.filter((entry) => entry.untracked).map((entry) => entry.path) };
  };
  const gitChange = async (options = {}) => {
    const compare = options.compare || "HEAD";
    const paths = options.paths;
    const [status, stat, patch, nameStatus, untrackedFiles, numstat] = await Promise.all([
      gitStatus({ paths }),
      gitOutput(["diff", "--no-ext-diff", "--stat", compare, ...gitPaths(paths)]),
      gitOutput(["diff", "--no-ext-diff", "--unified=3", compare, ...gitPaths(paths)]),
      gitNameStatus({ compare, paths }),
      gitUntrackedFiles({ paths }),
      gitOutput(["diff", "--no-ext-diff", "--numstat", compare, ...gitPaths(paths)]),
    ]);
    const totals = numstat.split("\n").filter(Boolean).reduce((sum, line) => {
      const [additions, deletions] = line.split("\t");
      return { additions: sum.additions + (Number(additions) || 0), deletions: sum.deletions + (Number(deletions) || 0) };
    }, { additions: 0, deletions: 0 });
    return {
      compare,
      ...(paths ? { paths: [...paths] } : {}),
      status,
      stat,
      patch,
      changedFiles: unique(nameStatus.flatMap((entry) => entry.from ? [entry.from, entry.path] : [entry.path])),
      untrackedFiles,
      renames: nameStatus.filter((entry) => entry.code === "R"),
      ...totals,
      nameStatus,
    };
  };

  const textClip = (value, options = {}) => {
    const text = String(value ?? "");
    const maxChars = options.maxChars === undefined ? 4_000 : options.maxChars;
    if (!Number.isInteger(maxChars) || maxChars < 0) fail("std.context.clippable maxChars must be a non-negative integer");
    if (text.length <= maxChars) return { text, truncated: false };
    if (maxChars === 0) return { text: "", truncated: true };
    const marker = options.marker || "\n[… clipped …]\n";
    if (maxChars <= marker.length) return { text: text.slice(0, maxChars), truncated: true };
    const strategy = options.strategy || "head-tail";
    if (strategy === "head") return { text: text.slice(0, maxChars - marker.length) + marker, truncated: true };
    if (strategy === "tail") return { text: marker + text.slice(-(maxChars - marker.length)), truncated: true };
    const head = Math.ceil((maxChars - marker.length) / 2);
    const tail = Math.floor((maxChars - marker.length) / 2);
    return { text: text.slice(0, head) + marker + text.slice(-tail), truncated: true };
  };
  const CONTEXT_MARKS = new WeakMap();
  const CONTEXT_SLOTS = new WeakSet();
  const contextMarked = (kind, value, options = {}) => {
    const marked = Object.freeze({ value });
    CONTEXT_MARKS.set(marked, { kind, ...options });
    return marked;
  };
  const contextRequired = (value) => contextMarked("required", value);
  const contextClippable = (value, options = {}) => contextMarked("clippable", value, options);
  const contextDroppable = (value, options = {}) => contextMarked("droppable", value, options);
  const materializeContext = (value, slots, path = "$") => {
    const policy = value && typeof value === "object" ? CONTEXT_MARKS.get(value) : undefined;
    if (policy) {
      const slot = { path, policy, original: value.value, value: value.value, active: true };
      CONTEXT_SLOTS.add(slot);
      slots.push(slot);
      if (policy.kind === "clippable") {
        if (typeof value.value !== "string") fail("std.context.clippable only supports strings at " + path);
        const clipped = textClip(value.value, { ...policy, maxChars: Math.min(policy.maxChars === undefined ? value.value.length : policy.maxChars, value.value.length) });
        slot.value = clipped.text;
        slot.truncated = clipped.truncated;
      }
      return slot;
    }
    if (Array.isArray(value)) return value.map((child, index) => materializeContext(child, slots, path + "[" + index + "]"));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, materializeContext(child, slots, path + "." + key)]));
    return value;
  };
  const resolveContext = (value) => {
    if (value && typeof value === "object" && CONTEXT_SLOTS.has(value)) return value.active ? resolveContext(value.value) : undefined;
    if (Array.isArray(value)) return value.map(resolveContext);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, child]) => !(child && typeof child === "object" && CONTEXT_SLOTS.has(child) && !child.active)).map(([key, child]) => [key, resolveContext(child)]));
    return value;
  };
  const contextFit = (value, options = {}) => {
    const maxSerializedChars = options.maxSerializedChars === undefined ? 48_000 : options.maxSerializedChars;
    if (!Number.isInteger(maxSerializedChars) || maxSerializedChars < 2) fail("std.context.fit expects maxSerializedChars >= 2");
    const slots = [];
    const tree = materializeContext(value, slots);
    const current = () => resolveContext(tree);
    const size = () => measure(current());
    const dropped = [];
    const truncated = slots.filter((slot) => slot.policy.kind === "clippable" && slot.truncated).map((slot) => slot.path);
    for (const slot of slots.filter((slot) => slot.policy.kind === "droppable").sort((left, right) => (left.policy.priority || 0) - (right.policy.priority || 0))) {
      if (size() <= maxSerializedChars) break;
      slot.active = false;
      dropped.push(slot.path);
    }
    for (const slot of slots.filter((slot) => slot.policy.kind === "clippable").sort((left, right) => (left.policy.priority || 0) - (right.policy.priority || 0))) {
      while (size() > maxSerializedChars && slot.value.length > 0) {
        const overhead = size() - slot.value.length;
        const allowed = Math.max(0, maxSerializedChars - overhead);
        const clipped = textClip(slot.original, { ...slot.policy, maxChars: allowed });
        slot.value = clipped.text.length < slot.value.length ? clipped.text : slot.value.slice(0, Math.max(0, slot.value.length - 1));
        slot.truncated = true;
        if (!truncated.includes(slot.path)) truncated.push(slot.path);
      }
    }
    const result = current();
    const serializedChars = measure(result);
    if (serializedChars > maxSerializedChars) throw new Error("std.context.fit cannot meet the context budget without dropping required data");
    return { value: result, truncated, dropped, serializedChars };
  };
  const contextPack = (items, options = {}) => {
    requireArray(items, "std.context.pack");
    const maxSerializedChars = options.maxSerializedChars === undefined ? 48_000 : options.maxSerializedChars;
    const priority = options.priority || "priority";
    const id = options.id || "id";
    const ordered = [...items].sort((left, right) => Number(idFor(right, priority) || 0) - Number(idFor(left, priority) || 0));
    const kept = [];
    const omitted = [];
    for (const item of ordered) (measure([...kept, item]) <= maxSerializedChars ? kept : omitted).push(item);
    return { items: kept, omitted, omittedIds: omitted.map((item) => idFor(item, id)).filter((value) => value !== undefined), serializedChars: measure(kept) };
  };
  const contextPartition = (items, options = {}) => {
    requireArray(items, "std.context.partition");
    const maxSerializedChars = options.maxSerializedChars === undefined ? 48_000 : options.maxSerializedChars;
    const batches = [];
    let batch = [];
    for (const item of items) {
      if (measure([item]) > maxSerializedChars) throw new Error("std.context.partition item exceeds the context budget");
      if (batch.length && measure([...batch, item]) > maxSerializedChars) { batches.push(batch); batch = []; }
      batch.push(item);
    }
    if (batch.length) batches.push(batch);
    return batches;
  };

  const evidenceItem = (item = {}) => {
    requireObject(item, "std.evidence.item");
    return Object.freeze({ id: item.id || "ev-" + nextEvidenceId++, kind: item.kind || "text", source: item.source || "program", locator: item.locator || {}, content: String(item.content || ""), truncated: Boolean(item.truncated) });
  };
  const evidenceBundle = (items) => ({ items: asArray(items).map((item) => evidenceItem(item)) });
  const evidenceIndex = (bundle) => Object.fromEntries(asArray(bundle && bundle.items).map((item) => [item.id, item]));
  const evidenceRequire = (bundle, ids) => {
    const index = evidenceIndex(bundle);
    const missing = asArray(ids).filter((id) => !index[id]);
    if (missing.length) throw new Error("Missing required evidence: " + missing.join(", "));
    return asArray(ids).map((id) => index[id]);
  };
  const evidencePack = (bundle, options = {}) => {
    const result = contextPack(asArray(bundle && bundle.items), { ...options, id: "id" });
    return { bundle: evidenceBundle(result.items), omittedIds: result.omittedIds, serializedChars: result.serializedChars };
  };

  const coverageCompare = (expected, actual, options = {}) => {
    requireArray(expected, "std.coverage.compare"); requireArray(actual, "std.coverage.compare");
    const key = options.id || options.key;
    const expectedIds = assertUniqueIds(expected, key, "expected");
    const actualIds = orderedIds(actual, key);
    const expectedSet = new Set(expectedIds);
    const counts = new Map();
    for (const id of actualIds) counts.set(id, (counts.get(id) || 0) + 1);
    const covered = expected.filter((item) => counts.has(idFor(item, key)));
    const missing = expected.filter((item) => !counts.has(idFor(item, key)));
    const unexpected = actual.filter((item) => !expectedSet.has(idFor(item, key)));
    const duplicates = actual.filter((item) => (counts.get(idFor(item, key)) || 0) > 1);
    return { covered, missing, unexpected, duplicates, complete: missing.length === 0 && unexpected.length === 0 && duplicates.length === 0 };
  };
  const coverageRequireComplete = (expected, actual, options) => {
    const result = coverageCompare(expected, actual, options);
    if (!result.complete) throw new Error("Coverage incomplete: missing=" + result.missing.length + ", unexpected=" + result.unexpected.length + ", duplicates=" + result.duplicates.length);
    return result;
  };
  const reconcileById = (base, overlays, options = {}) => {
    requireArray(base, "std.reconcile.byId"); requireArray(overlays, "std.reconcile.byId");
    const key = options.id || options.key || "id";
    const baseIds = assertUniqueIds(base, key, "base");
    const baseById = new Map(base.map((item) => [idFor(item, key), item]));
    const grouped = new Map();
    for (const overlay of overlays) {
      const id = idFor(overlay, key);
      if (id === undefined || id === null || id === "") continue;
      const group = grouped.get(id) || [];
      group.push(overlay);
      grouped.set(id, group);
    }
    const unknownIds = [...grouped.keys()].filter((id) => !baseById.has(id));
    const duplicateIds = [...grouped.entries()].filter(([, items]) => items.length > 1).map(([id]) => id);
    const missingIds = baseIds.filter((id) => !grouped.has(id));
    const values = base.map((item) => {
      const overlay = grouped.get(idFor(item, key)) && grouped.get(idFor(item, key))[0];
      if (!overlay) return item;
      if (options.overlay === false) return overlay;
      return item && typeof item === "object" && !Array.isArray(item) && typeof overlay === "object" && !Array.isArray(overlay)
        ? { ...item, ...overlay }
        : overlay;
    });
    return { values, unknownIds, missingIds, duplicateIds };
  };
  const reconcileOneToOne = (expected, actual, options = {}) => {
    const key = options.id || options.key || ((value) => value);
    const coverage = coverageCompare(expected, actual, { id: key });
    return { pairs: reconcileById(expected, actual, { id: key, overlay: true }).values, ...coverage };
  };

  const agentsPlanFanoutReduce = async (input, options = {}) => {
    requireObject(options, "std.agents.planFanoutReduce");
    const planSpec = options.plan; const fanoutSpec = options.fanout; const reduceSpec = options.reduce;
    requireObject(planSpec, "std.agents.planFanoutReduce plan"); requireObject(fanoutSpec, "std.agents.planFanoutReduce fanout"); requireObject(reduceSpec, "std.agents.planFanoutReduce reduce");
    if (typeof planSpec.prompt !== "string" || !planSpec.prompt) fail("std.agents.planFanoutReduce plan.prompt is required");
    if (typeof planSpec.profile !== "string" || !planSpec.profile) fail("std.agents.planFanoutReduce plan.profile is required");
    if (typeof fanoutSpec.profile !== "string" || !fanoutSpec.profile) fail("std.agents.planFanoutReduce fanout.profile is required");
    if (typeof reduceSpec.prompt !== "string" || !reduceSpec.prompt) fail("std.agents.planFanoutReduce reduce.prompt is required");
    if (typeof reduceSpec.profile !== "string" || !reduceSpec.profile) fail("std.agents.planFanoutReduce reduce.profile is required");
    const planOutputSchema = planSpec.outputSchema || {
      type: "object",
      properties: {
        fanout: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: { prompt: { type: "string", minLength: 1 }, name: { type: "string" }, context: { type: "object", additionalProperties: true } },
            required: ["prompt"],
            additionalProperties: false,
          },
        },
      },
      required: ["fanout"],
      additionalProperties: false,
    };
    const plan = await stdAgent({ task: planSpec.prompt, profile: planSpec.profile, tools: planSpec.tools, systemPrompt: planSpec.systemPrompt, context: { input, ...(planSpec.context || {}) }, outputSchema: planOutputSchema });
    const items = plan && plan.fanout;
    requireArray(items, "std.agents.planFanoutReduce planner result fanout");
    const results = await stdParallel(items, async (item, index) => {
      if (!item || typeof item !== "object" || typeof item.prompt !== "string" || !item.prompt) fail("std.agents.planFanoutReduce planner fanout items require prompt");
      return stdRunAgent({ name: item.name || "fanout-" + (index + 1), task: item.prompt, profile: fanoutSpec.profile, tools: fanoutSpec.tools, systemPrompt: fanoutSpec.systemPrompt, context: { input, plan, ...(fanoutSpec.context || {}), ...(item.context || {}) }, outputSchema: fanoutSpec.outputSchema });
    }, fanoutSpec.concurrency);
    const value = await stdAgent({ task: reduceSpec.prompt, profile: reduceSpec.profile, tools: reduceSpec.tools, systemPrompt: reduceSpec.systemPrompt, context: { input, plan, results, ...(reduceSpec.context || {}) }, outputSchema: reduceSpec.outputSchema });
    return { plan, results, value };
  };

  const fsRead = (path, options = {}) => stdPi.read({ path, ...options });
  const fsExists = async (path) => (await shellRun("test -e " + shellQuote(path))).ok;
  const repoCommands = async () => {
    if (!(await fsExists("package.json"))) return {};
    try { return JSON.parse(await fsRead("package.json")).scripts || {}; }
    catch (error) { throw new Error("std.dev could not parse package.json: " + (error instanceof Error ? error.message : String(error))); }
  };
  const repoCodeowners = async () => (await fsExists("CODEOWNERS")) ? fsRead("CODEOWNERS") : (await fsExists(".github/CODEOWNERS")) ? fsRead(".github/CODEOWNERS") : undefined;
  const repoFindReferences = (symbol, options = {}) => stdPi.grep({ pattern: symbol, literal: true, limit: options.limit });
  const repoFindDefinitions = (symbol, options = {}) => stdPi.grep({ pattern: "(function|class|interface|type|const|let|var)\\s+" + String(symbol), limit: options.limit });
  const repoRelatedFiles = async (path, limit = 256) => {
    requirePositiveInteger(limit, "std.repo related-file limit");
    const normalized = String(path).replace(/^\.\//, "");
    const slash = normalized.lastIndexOf("/");
    const directory = slash < 0 ? "." : normalized.slice(0, slash);
    const filename = slash < 0 ? normalized : normalized.slice(slash + 1);
    const stem = filename.replace(/\.[^.]+$/, "");
    const output = await shellOutput("find " + shellQuote(directory) + " -type f -name " + shellQuote(stem + ".*") + " -print | head -n " + String(limit + 1));
    const files = output.split("\n").filter(Boolean).map((value) => value.replace(/^\.\//, ""));
    if (files.length > limit) throw new Error("std.repo related-file discovery exceeded limit " + limit);
    return files;
  };
  const repoNeighboringTests = async (path) => (await repoRelatedFiles(path)).filter((file) => /(^|\.)((test|spec))\.[^/]+$|__tests__/.test(file));
  const repoConfigDirectoryCache = new Map();
  const repoConfigInDirectory = (directory) => {
    const key = directory || ".";
    if (repoConfigDirectoryCache.has(key)) return repoConfigDirectoryCache.get(key);
    const candidates = ["AGENTS.md", ".editorconfig", "tsconfig.json", "package.json"].map((name) => directory ? directory + "/" + name : name);
    const pending = shellOutput("for p in " + shellArgs(candidates) + "; do if [ -f \"$p\" ]; then printf '%s\\n' \"$p\"; fi; done").then((output) => output.split("\n").filter(Boolean));
    repoConfigDirectoryCache.set(key, pending);
    return pending;
  };
  const repoConfigFor = async (path) => {
    const parts = String(path).replace(/^\.\//, "").split("/");
    const directories = Array.from({ length: Math.max(1, parts.length) }, (_value, index) => parts.slice(0, index).join("/"));
    return unique((await Promise.all(directories.map(repoConfigInDirectory))).flat());
  };
  const repoChangeNeighborhood = async (options = {}) => {
    const include = new Set(options.include || ["tests", "config"]);
    const supported = new Set(["definitions", "references", "tests", "config", "owners"]);
    const unsupported = [...include].filter((item) => !supported.has(item));
    if (unsupported.length) throw new Error("std.repo.changeNeighborhood unsupported include: " + unsupported.join(", "));
    const change = await gitChange(options);
    const files = change.changedFiles;
    const termFor = (path) => String(path).split("/").at(-1).replace(/\.[^.]+$/, "");
    return {
      change,
      ...(include.has("definitions") ? { definitions: Object.fromEntries(await Promise.all(files.map(async (file) => [file, await repoFindDefinitions(termFor(file), { limit: 100 })]))) } : {}),
      ...(include.has("references") ? { references: Object.fromEntries(await Promise.all(files.map(async (file) => [file, await repoFindReferences(termFor(file), { limit: 100 })]))) } : {}),
      ...(include.has("tests") ? { tests: Object.fromEntries(await Promise.all(files.map(async (file) => [file, await repoNeighboringTests(file)]))) } : {}),
      ...(include.has("config") ? { config: Object.fromEntries(await Promise.all(files.map(async (file) => [file, await repoConfigFor(file)]))) } : {}),
      ...(include.has("owners") ? { owners: await repoCodeowners() } : {}),
    };
  };

  const READ_ONLY_AGENT_TOOLS = Object.freeze(["read", "grep", "find", "ls"]);
  const onlyReadOnlyTools = (tools, name) => {
    if (tools === undefined) return [...READ_ONLY_AGENT_TOOLS];
    requireArray(tools, name + " tools");
    const disallowed = tools.filter((tool) => !READ_ONLY_AGENT_TOOLS.includes(tool));
    if (disallowed.length) throw new Error(name + " permits only read, grep, find, ls; use raw agent/agents.run for other tools");
    return [...tools];
  };
  const devEvidence = (options) => repoChangeNeighborhood({ compare: options.compare, paths: options.paths });
  const devAnalyzeChange = async (options = {}) => {
    if (typeof options.instruction !== "string" || !options.instruction.trim()) fail("std.dev.analyzeChange requires instruction");
    if (!options.schema) fail("std.dev.analyzeChange requires schema");
    return stdAgent({ task: options.instruction, profile: options.profile || "balanced", tools: onlyReadOnlyTools(options.tools, "std.dev.analyzeChange"), context: { evidence: await devEvidence(options) }, outputSchema: options.schema });
  };
  const devAnalyzeFailure = async (options = {}) => {
    if (typeof options.instruction !== "string" || !options.instruction.trim()) fail("std.dev.analyzeFailure requires instruction");
    if (!options.schema) fail("std.dev.analyzeFailure requires schema");
    if (options.failure === undefined && options.logs === undefined) fail("std.dev.analyzeFailure requires failure or logs");
    return stdAgent({ task: options.instruction, profile: options.profile || "balanced", tools: onlyReadOnlyTools(options.tools, "std.dev.analyzeFailure"), context: { failure: options.failure, logs: options.logs, evidence: await devEvidence(options) }, outputSchema: options.schema });
  };
  const devFindRelevantTests = async (options = {}, commands) => {
    const neighborhood = await repoChangeNeighborhood({ compare: options.compare, paths: options.paths, include: ["tests"] });
    return { files: neighborhood.change.changedFiles, tests: neighborhood.tests || {}, commands: commands || await repoCommands() };
  };
  const devRunRelevantTests = async (options = {}) => {
    if (options.command !== undefined && (typeof options.command !== "string" || !options.command.includes("{tests}"))) {
      fail("std.dev.runRelevantTests command must include the {tests} placeholder");
    }
    const commands = await repoCommands();
    const tests = await devFindRelevantTests(options, commands);
    const selectedTests = unique(Object.values(tests.tests).flat());
    const maxTests = options.maxTests === undefined ? 128 : options.maxTests;
    requirePositiveInteger(maxTests, "std.dev.runRelevantTests maxTests");
    if (selectedTests.length > maxTests) throw new Error("std.dev.runRelevantTests discovered " + selectedTests.length + " tests, exceeding maxTests " + maxTests);
    if (!selectedTests.length) return { status: "not_run", reason: "No neighboring tests discovered", selectedTests, tests };
    const quotedTests = shellArgs(selectedTests);
    const command = options.command
      ? options.command.replaceAll("{tests}", quotedTests)
      : commands["test:unit"]
        ? "npm run test:unit -- " + quotedTests
        : commands.test
          ? "npm test -- " + quotedTests
          : undefined;
    if (!command) return { status: "not_run", reason: "No explicit command template and no package test script found", selectedTests, tests };
    const result = await shellRun(command, { timeout: options.timeout });
    return { status: result.ok ? "passed" : "failed", command, output: result.output, selectedTests, tests };
  };

  const freeze = (object) => Object.freeze(object);
  Object.defineProperty(globalThis, "std", {
    value: freeze({
      git: freeze({ change: gitChange }),
      repo: freeze({ changeNeighborhood: repoChangeNeighborhood }),
      context: freeze({ required: contextRequired, clippable: contextClippable, droppable: contextDroppable, fit: contextFit, pack: contextPack, partition: contextPartition }),
      evidence: freeze({ item: evidenceItem, bundle: evidenceBundle, pack: evidencePack, require: evidenceRequire }),
      coverage: freeze({ compare: coverageCompare, requireComplete: coverageRequireComplete }),
      reconcile: freeze({ byId: reconcileById, oneToOne: reconcileOneToOne }),
      agents: freeze({ planFanoutReduce: agentsPlanFanoutReduce }),
      dev: freeze({ analyzeChange: devAnalyzeChange, analyzeFailure: devAnalyzeFailure, findRelevantTests: devFindRelevantTests, runRelevantTests: devRunRelevantTests }),
    }),
    writable: false,
    configurable: false,
  });
`;
