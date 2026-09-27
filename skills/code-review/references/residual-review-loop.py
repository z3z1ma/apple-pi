import asyncio
import json
import re
from typing import Any

READ_ONLY = ["read", "grep", "find", "ls"]
PLANNER = "<inline adapted references/planner.md>"
REVIEWER = "<inline adapted references/reviewer.md>"
VERIFIER = "<inline adapted references/verifier.md>"
GUARD = " Read-only: do not invoke code-review, spawn reviewers, or re-enter this graph. Findings are hypotheses; the root owns reconciliation and all mutation."
AXES = ["standards", "intent"]

def lines(key: str) -> list[str]:
    return [line.strip() for line in inputs.get(key, "").splitlines() if line.strip()]

files = lines("paths")
contextFiles = lines("contextPaths")
standardsPaths = lines("standardsPaths")
intentPaths = lines("intentPaths")
smellBaselinePath = inputs.get("smellBaselinePath", "").strip()
background = inputs.get("background", "").strip()
compare = inputs.get("compare", "").strip()
expectedAxes = [inputs.get("axis", "").strip()]
if not files or not compare or not expectedAxes:
    raise ValueError("inputs.paths, inputs.compare, and assessed axes are required")
if compare != "HEAD" and not re.fullmatch(r"[A-Za-z0-9._/@{}~^:+-]+\.\.\.HEAD", compare):
    raise ValueError("inputs.compare must be HEAD or an explicit <fixed-point>...HEAD range")
if len(set(expectedAxes)) != len(expectedAxes) or any(axis not in AXES for axis in expectedAxes):
    raise ValueError("axes must contain unique standards and/or intent lines")
if "standards" in expectedAxes and not smellBaselinePath:
    raise ValueError("inputs.smellBaselinePath is required for a Standards review")

findingSchema = schema({
    "findings": [{"axis": AXES, "title": "string", "severity": ["critical", "significant", "minor"],
                  "path": "string", "startLine": "int?", "endLine": "int?", "contract": "string",
                  "trigger": "string", "evidence": "string", "impact": "string", "recommendation": "string"}],
    "notes": [{"topic": "string", "observation": "string"}],
})
decisionSchema = schema({
    "decisions": [{"candidateId": "string", "axis": AXES, "title": "string", "path": "string",
                   "startLine": "int?", "contract": "string", "status": ["confirmed", "rejected", "unresolved", "duplicate"],
                   "priorDisposition": ["not-applicable", "addressed", "open", "rejected", "unresolved"],
                   "severity": ["critical", "significant", "minor"], "scope": ["in-scope", "out-of-scope"],
                   "loadBearing": "boolean", "duplicateOf": "string?", "trigger": "string", "evidence": "string",
                   "impact": "string", "recommendation": "string", "suggestedOwner": "string?",
                   "revisitCondition": "string?", "reason": "string"}],
    "summary": "string", "compoundRisks": ["string"], "residualRisks": ["string"], "coverageGaps": ["string"],
})

def coverage(expected: list[str], actual: list[str]) -> dict[str, Any]:
    missing = sorted(set(expected) - set(actual))
    unexpected = sorted(set(actual) - set(expected))
    return {"missing": missing, "unexpected": unexpected, "complete": not missing and not unexpected}

def validateDecisions(candidates: list[Any], decisions: list[Any]) -> dict[str, Any]:
    base = {item["candidateId"]: item for item in candidates}
    decided = {item["candidateId"]: item for item in decisions}
    ids = [item["candidateId"] for item in decisions]
    unknownIds = sorted(set(ids) - set(base))
    missingIds = sorted(set(base) - set(ids))
    duplicateIds = sorted({id for id in ids if ids.count(id) > 1})
    if len(base) != len(candidates) or unknownIds or missingIds or duplicateIds:
        raise ValueError("coverage failure: decisions have unknown, missing, or duplicate candidate IDs")
    for decision in decisions:
        candidate = base[decision["candidateId"]]
        for field in ["axis", "scope", "title", "path", "contract"]:
            if decision[field] != candidate[field]:
                raise ValueError("decision changed immutable candidate fields")
        effective = decision
        seen: set[str] = set()
        while effective["status"] == "duplicate":
            id = effective["candidateId"]
            target = effective.get("duplicateOf")
            if id in seen or target not in decided:
                raise ValueError("invalid duplicate chain")
            seen.add(id)
            effective = decided[target]
            if effective["axis"] != decision["axis"]:
                raise ValueError("cross-axis duplicate target")
        if effective["status"] not in ["confirmed", "rejected", "unresolved"]:
            raise ValueError("duplicate has no terminal decision")
        if decision["status"] == "duplicate" and effective["severity"] != decision["severity"]:
            raise ValueError("duplicate must preserve terminal severity")
        material = effective["status"] in ["confirmed", "unresolved"] and effective["severity"] in ["critical", "significant"]
        if material and decision["scope"] == "in-scope" and not decision["loadBearing"]:
            raise ValueError("in-scope material decision must be load-bearing")
        if material and decision["scope"] == "out-of-scope" and (not decision.get("suggestedOwner") or not decision.get("revisitCondition")):
            raise ValueError("out-of-scope material decision needs owner and revisit metadata")
        for field in ["contract", "trigger", "evidence", "impact", "recommendation"]:
            if not decision[field].strip():
                raise ValueError("decision needs evidence: " + field)
        disposition = decision["priorDisposition"]
        if candidate["source"] == "fresh" and disposition != "not-applicable":
            raise ValueError("fresh decision needs not-applicable priorDisposition")
        if candidate["source"] == "prior":
            allowed = {"confirmed": ["open"], "unresolved": ["unresolved"], "rejected": ["addressed", "rejected"]}
            if disposition not in allowed[effective["status"]]:
                raise ValueError("prior decision has inconsistent disposition")
    return {"unknownIds": unknownIds, "missingIds": missingIds, "duplicateIds": duplicateIds, "complete": True}

def candidateize(review: Any) -> list[Any]:
    result: list[Any] = []
    focus = review["focus"]
    for index, finding in enumerate(review["findings"]):
        if finding["axis"] != focus["axis"]:
            raise ValueError("axis mismatch in " + focus["id"])
        result.append({**finding, "candidateId": f"fresh-{focus['id']}-{index + 1}", "source": "fresh",
                       "focusId": focus["id"], "partitionId": focus["partitionId"],
                       "scope": "in-scope" if finding["path"] in focus["targetFiles"] else "out-of-scope", "loadBearing": False})
    return result

boundaryChange = await git_change(compare=compare)
change = await git_change(compare=compare, paths=files)
boundaryPaths = sorted(set(boundaryChange["changedFiles"] + boundaryChange["untrackedFiles"]))
scopedPaths = sorted(set(change["changedFiles"] + change["untrackedFiles"]))
if not boundaryPaths:
    raise ValueError("coverage failure: the selected comparison is empty")
pathScopeCoverage = coverage(boundaryPaths, scopedPaths)
if not pathScopeCoverage["complete"]:
    raise ValueError("coverage failure: requested paths omit changed files")
commitList: list[str] = []
if compare != "HEAD":
    commitResult = await bash(command="git log --oneline '" + compare[:-7] + "..HEAD'")
    if not commitResult["ok"]:
        raise ValueError("Could not resolve commit list")
    commitList = commitResult["output"].strip().splitlines()
boundedFit = await context_fit(value={
    "files": files, "contextFiles": contextFiles, "standardsPaths": standardsPaths, "intentPaths": intentPaths,
    "smellBaselinePath": smellBaselinePath, "expectedAxes": expectedAxes, "background": background,
    "compare": compare, "statusText": boundaryChange["statusText"], "stat": boundaryChange["stat"],
    "changedFiles": boundaryChange["changedFiles"], "nameStatus": boundaryChange["nameStatus"],
    "untrackedFiles": boundaryChange["untrackedFiles"], "commitList": commitList, "pathScopeCoverage": pathScopeCoverage,
    "patch": await context_clippable(value=change["patch"], max_chars=16000, strategy="head-tail"),
}, flags={"patchTruncated": "$.patch"})
bounded = boundedFit["value"]

async def investigate(focus: Any) -> dict[str, Any]:
    try:
        patch = await git_patch(compare=compare, paths=focus["targetFiles"])
        fitted = await context_fit(value={**bounded, "focus": focus,
            "patch": await context_clippable(value=patch, max_chars=16000, strategy="head-tail")})
        context = fitted["value"]
        context["patchTruncated"] = bool(fitted["truncated"]) or bounded["patchTruncated"]
        result = await agent_run(name=focus["id"], profile="quick", tools=READ_ONLY,
            system_prompt=REVIEWER + GUARD, task="Perform the assigned read-only, evidence-backed focus investigation.",
            context=context, output_schema=findingSchema)
        value = result.get("value") or {}
        return {"focus": focus, "status": result["status"], "findings": value.get("findings", []),
                "notes": value.get("notes", []), "patchTruncated": context["patchTruncated"], "error": result.get("error")}
    except Exception as error:
        return {"focus": focus, "status": "failed", "findings": [], "notes": [], "patchTruncated": False, "error": str(error)}

async def candidatePack(candidates: list[Any], budget: int = 12000) -> dict[str, Any]:
    return await context_pack(items=[{**item, "priority": {"critical": 3, "significant": 2, "minor": 1}[item["severity"]]} for item in candidates],
                              id="candidateId", priority="priority", max_serialized_chars=budget)

async def verifyGroup(axis: str, groupId: str, members: list[Any]) -> dict[str, Any]:
    batch = await candidatePack(members)
    if batch["omitted"]:
        raise ValueError("coverage failure: semantic group omitted candidates: " + groupId)
    verdict = await agent(name=axis + "-" + groupId + "-reducer", profile="balanced", tools=READ_ONLY,
        system_prompt=VERIFIER + GUARD, task="Independently inspect and decide this complete same-axis semantic group.",
        context={**bounded, "axis": axis, "candidates": batch["items"]}, output_schema=decisionSchema)
    validateDecisions(members, verdict["decisions"])
    return {"groupId": groupId, "candidateReceipts": members, **verdict}

async def verifyAxis(axis: str, candidates: list[Any], reviews: list[Any], extra: Any) -> dict[str, Any]:
    members = [item for item in candidates if item["axis"] == axis]
    packed = await candidatePack(members)
    reductionEvidence: list[Any] = []
    if packed["omitted"]:
        groups: dict[str, Any] = {}
        for item in members:
            groupId = item["partitionId"]
            groups.setdefault(groupId, []).append(item)
        reductions = await asyncio.gather(*[verifyGroup(axis, groupId, group) for groupId, group in groups.items()])
        reductionPack = await context_pack(items=[{"id": item["groupId"], "verdict": item} for item in reductions], max_serialized_chars=24000)
        if reductionPack["omitted"]:
            raise ValueError("coverage failure: final axis fan-in omitted semantic reductions")
        reductionEvidence = reductionPack["items"]
    axisReviews = [review for review in reviews if review["focus"]["axis"] == axis]
    notes = [{**note, "id": f"{review['focus']['id']}-note-{index + 1}", "focusId": review["focus"]["id"]}
             for review in axisReviews for index, note in enumerate(review["notes"])]
    packedNotes = await context_pack(items=notes, fields={"topic": 160, "observation": 400}, max_serialized_chars=8000)
    failedFocuses = [{"id": review["focus"]["id"], "error": review["error"] or "worker failed"} for review in axisReviews if review["status"] != "completed"]
    truncatedFocuses = [review["focus"]["id"] for review in axisReviews if review["patchTruncated"]]
    focusCoverage = [{**review["focus"], "status": review["status"], "patchTruncated": review["patchTruncated"]} for review in axisReviews]
    finalVerdict = await agent(name=axis + "-final-verifier", profile="deep", tools=READ_ONLY,
        system_prompt=VERIFIER + GUARD,
        task="Independently decide every original same-axis candidate exactly once and assess coverage. Never merge or rerank across axes.",
        context={**bounded, **extra, "axis": axis, "candidateIds": [item["candidateId"] for item in members],
                 "candidates": [] if reductionEvidence else packed["items"], "reductionEvidence": reductionEvidence,
                 "focusCoverage": focusCoverage, "notes": packedNotes["items"], "noteIdsOmitted": packedNotes["omittedIds"],
                 "failedFocuses": failedFocuses, "truncatedFocuses": truncatedFocuses}, output_schema=decisionSchema)
    reconciliation = validateDecisions(members, finalVerdict["decisions"])
    gaps = list(finalVerdict["coverageGaps"])
    if failedFocuses:
        gaps.append("One or more review workers failed.")
    if truncatedFocuses or bounded["patchTruncated"]:
        gaps.append("Review evidence was truncated.")
    if packedNotes["omittedIds"] or packedNotes["clipped"]:
        gaps.append("Review notes were omitted or clipped from final fan-in.")
    return {**finalVerdict, "axis": axis, "reconciliation": reconciliation, "coverageGaps": gaps,
            "failedFocuses": failedFocuses, "truncatedFocuses": truncatedFocuses, "noteIdsOmitted": packedNotes["omittedIds"]}

async def finish(candidates: list[Any], reviews: list[Any], extra: Any) -> dict[str, Any]:
    axisVerdicts = await asyncio.gather(*[verifyAxis(axis, candidates, reviews, extra) for axis in expectedAxes])
    decisions = [decision for verdict in axisVerdicts for decision in verdict["decisions"]]
    decisionReconciliation = validateDecisions(candidates, decisions)
    coverageGaps = [verdict["axis"] + ": " + gap for verdict in axisVerdicts for gap in verdict["coverageGaps"]]
    return {"scope": {key: bounded[key] for key in ["files", "compare", "expectedAxes", "statusText", "stat", "changedFiles", "nameStatus", "untrackedFiles", "commitList", "pathScopeCoverage"]},
            "candidates": len(candidates), "candidateReceipts": candidates,
            "failedFocuses": [failure for verdict in axisVerdicts for failure in verdict["failedFocuses"]],
            "truncatedFocuses": [id for verdict in axisVerdicts for id in verdict["truncatedFocuses"]],
            "patchTruncated": bounded["patchTruncated"], "noteIdsOmitted": [id for verdict in axisVerdicts for id in verdict["noteIdsOmitted"]],
            "coverageGaps": coverageGaps, "coverageComplete": decisionReconciliation["complete"] and not coverageGaps,
            "decisionReconciliation": decisionReconciliation, "meta": {"decisions": decisions, "axisVerdicts": axisVerdicts}}

# Exactly one additional investigation wave: every material gap, with no arbitrary cap.
axis = expectedAxes[0]
question = inputs.get("question", "").strip()
if not question:
    raise ValueError("inputs.question is required")
def residualFocus(id: str, question: str) -> dict[str, Any]:
    return {"id": id, "axis": axis, "title": question, "question": question, "partitionId": id,
            "partitionTitle": axis, "targetFiles": files, "contextFiles": contextFiles,
            "checks": ["Trace the contract through changed branches, producers, consumers, guards, and tests."], "rationale": background}
initial = await investigate(residualFocus("initial", question))
initialCandidates = candidateize(initial)
initialPack = await candidatePack(initialCandidates)
if initialPack["omitted"]:
    raise ValueError("coverage failure: triage omitted candidates; no clean output is allowed")
triage = await agent(name="coverage-triage", profile="balanced", tools=READ_ONLY, system_prompt=VERIFIER + GUARD,
    task="Decide every initial candidate and return only material, falsifiable residual coverage questions.",
    context={**bounded, "axis": axis, "candidates": initialPack["items"], "notes": initial["notes"],
             "focusCoverage": [{**initial["focus"], "status": initial["status"], "patchTruncated": initial["patchTruncated"]}],
             "failedFocuses": [] if initial["status"] == "completed" else [{"id": "initial", "error": initial["error"]}]},
    output_schema=decisionSchema)
validateDecisions(initialCandidates, triage["decisions"])
materialGaps = list(dict.fromkeys(gap.strip() for gap in triage["coverageGaps"] if gap.strip()))
residuals = await asyncio.gather(*[investigate(residualFocus(f"residual-{index + 1}", gap)) for index, gap in enumerate(materialGaps)])
reviews = [initial, *residuals]
candidates = [item for review in reviews for item in candidateize(review)]
result = await finish(candidates, reviews, {"triageDecisions": triage["decisions"], "triageCoverageGaps": materialGaps})
result["initialCandidates"] = len(initialCandidates)
result["materialCoverageGaps"] = materialGaps
result["residualPasses"] = len(residuals)
result
