import { expect, test } from "vitest";
import {
	planPasses,
	type ReviewPlan,
	type ReviewReport,
	unscopedRegions,
	validateFindings,
	validatePlan,
	validateReport,
	validateShard,
} from "../src/contracts.js";
import type { ChangeRegion } from "../src/types.js";

const regions: ChangeRegion[] = [
	{
		id: "api-request",
		path: "api.ts",
		kind: "text",
		oldStart: 10,
		oldCount: 2,
		newStart: 10,
		newCount: 2,
		patch: "request",
	},
	{
		id: "api-lifetime",
		path: "api.ts",
		kind: "text",
		oldStart: 90,
		oldCount: 2,
		newStart: 90,
		newCount: 2,
		patch: "lifetime",
	},
	{
		id: "ui-request",
		path: "web/form.tsx",
		kind: "text",
		oldStart: 5,
		oldCount: 2,
		newStart: 5,
		newCount: 2,
		patch: "form",
	},
];
const roles = new Set(["code-review-specialist", "distributed-systems-researcher"]);
function plan(): ReviewPlan {
	return {
		artifact: "captured-target",
		summary: "Request consent and resource lifetime are separate behaviors.",
		chunks: [
			{
				id: "request",
				title: "Preserve consent across the request",
				paths: ["api.ts", "web"],
				context: ["protocol.ts"],
				risks: [{ kind: "contract", reason: "The renderer and backend must agree." }],
				passes: [
					{
						id: "request-correctness",
						role: "code-review-specialist",
						depth: "standard",
						lenses: ["correctness"],
						questions: [
							{
								id: "consent",
								question: "Do the selected IDs reach the backend unchanged?",
								verification: "Trace the real renderer, preload and backend arguments.",
							},
						],
					},
				],
			},
			{
				id: "lifetime",
				title: "Release the resource",
				paths: ["api.ts"],
				context: [],
				risks: [],
				passes: [
					{
						id: "lifetime-correctness",
						role: "code-review-specialist",
						depth: "standard",
						lenses: ["correctness"],
						questions: [
							{
								id: "release",
								question: "Is the resource released after the request?",
								verification: "Inspect ownership and the terminal path.",
							},
						],
					},
				],
			},
		],
		integration: {
			role: "code-review-specialist",
			depth: "standard",
			questions: [
				{
					id: "journey",
					question: "Does the full request preserve consent through resource release?",
					verification: "Trace the complete journey and challenge the chunk boundaries.",
				},
			],
		},
	};
}

function report(): ReviewReport {
	return {
		artifact: "captured-target",
		pass: "request-correctness",
		summary: "The source trace preserves selected IDs.",
		coverage: [
			{
				question: "consent",
				state: "completed",
				evidence: ["api.ts:10 forwards the selected IDs to the backend."],
				reason: "",
			},
		],
		findings: [],
		limitations: [],
		extraPasses: [],
	};
}

test("a report accounts for every question and cannot claim completed coverage without evidence", () => {
	const pass = planPasses(plan(), regions)[0]!;
	const paths = new Set(["api.ts", "web/form.tsx"]);
	expect(validateReport(report(), "captured-target", pass, paths).coverage[0]!.state).toBe("completed");
	const missing = report();
	missing.coverage = [];
	expect(() => validateReport(missing, "captured-target", pass, paths)).toThrow("Missing question");
	const unsupported = report();
	unsupported.coverage[0]!.evidence = [];
	expect(() => validateReport(unsupported, "captured-target", pass, paths)).toThrow("no evidence");
	unsupported.coverage[0]!.state = "incomplete";
	unsupported.coverage[0]!.reason = "The required host check was unavailable.";
	expect(validateReport(unsupported, "captured-target", pass, paths).coverage[0]!.state).toBe("incomplete");
	expect(() => validateReport(report(), "new-target", pass, paths)).toThrow("different artifact");
});

test("validation coverage gaps name actual inspected questions", () => {
	const value = {
		artifact: "captured-target",
		summary: "Check the claim",
		findings: [],
		coverageGaps: [
			{ pass: "request-correctness", question: "consent", reason: "The evidence does not trace the called guard." },
		],
		limitations: [],
	};
	expect(validateFindings(value, "captured-target", [report()]).coverageGaps).toHaveLength(1);
	value.coverageGaps[0]!.question = "invented-question";
	expect(() => validateFindings(value, "captured-target", [report()])).toThrow("Unknown coverage gap");
});

test("finding validation retains every allegation and rejects circular or invented duplicate associations", () => {
	const findings = report();
	findings.findings = ["first", "second"].map((id) => ({
		id,
		title: "Consent changes after selection",
		path: "api.ts",
		line: 10,
		side: "after",
		severity: "high",
		certainty: "probable",
		trigger: "The roster changes while a request waits.",
		invariant: "Selection must stay fixed.",
		impact: "An unintended person can be selected.",
		cause: "The backend expands the roster again.",
		correction: "Retain the selected identifiers.",
		evidence: [{ kind: "source", detail: "api.ts:10 expands the current roster.", provenance: "captured source" }],
		counterevidence: "No caller guard was found.",
	}));
	const incomplete = {
		artifact: "captured-target",
		summary: "Challenge findings",
		findings: [],
		coverageGaps: [],
		limitations: [],
	};
	expect(() => validateFindings(incomplete, "captured-target", [findings])).toThrow("Missing finding dispositions");
	const valid = {
		...incomplete,
		findings: [
			{
				finding: "request-correctness:first",
				disposition: "confirmed",
				reason: "The caller does not narrow the request.",
				evidence: ["Traced the captured caller and backend."],
				duplicateOf: null,
			},
			{
				finding: "request-correctness:second",
				disposition: "duplicate",
				reason: "Same trigger, invariant and faulty expansion.",
				evidence: ["Both reports identify the same roster expansion."],
				duplicateOf: "request-correctness:first",
			},
		],
	};
	expect(validateFindings(valid, "captured-target", [findings]).findings).toHaveLength(2);
	valid.findings[0]!.disposition = "duplicate";
	valid.findings[0]!.duplicateOf = "request-correctness:second";
	expect(() => validateFindings(valid, "captured-target", [findings])).toThrow("cycle");
});

test("a single-report validator may name findings by their bare IDs", () => {
	const findings = report();
	findings.findings = ["first", "second"].map((id) => ({
		id,
		title: "Consent changes after selection",
		path: "api.ts",
		line: 10,
		side: "after",
		severity: "high",
		certainty: "probable",
		trigger: "The roster changes while a request waits.",
		invariant: "Selection must stay fixed.",
		impact: "An unintended person can be selected.",
		cause: "The backend expands the roster again.",
		correction: "Retain the selected identifiers.",
		evidence: [{ kind: "source", detail: "api.ts:10 expands the current roster.", provenance: "captured source" }],
		counterevidence: "No caller guard was found.",
	}));
	const shard = validateShard(
		{
			artifact: "captured-target",
			summary: "Challenge findings",
			coverageGaps: [],
			limitations: [],
			findings: [
				{ finding: "first", disposition: "confirmed", reason: "Traced.", evidence: ["caller"], duplicateOf: null },
				{ finding: "second", disposition: "duplicate", reason: "Same.", evidence: ["caller"], duplicateOf: "first" },
			],
		},
		"captured-target",
		findings,
	);
	expect(shard.findings.map((entry) => [entry.finding, entry.duplicateOf])).toEqual([
		["request-correctness:first", null],
		["request-correctness:second", "request-correctness:first"],
	]);
});

test("the runtime maps scope paths to regions, keeps unscoped regions for integration and refuses empty scopes", () => {
	const narrow = plan();
	narrow.chunks[0]!.paths = ["api.ts"];
	const accepted = validatePlan(narrow, "captured-target", regions, roles);
	expect(unscopedRegions(accepted, regions)).toEqual(["ui-request"]);
	expect(planPasses(accepted, regions).at(-1)!.regions).toEqual(["api-request", "api-lifetime", "ui-request"]);
	const empty = plan();
	empty.chunks[1]!.paths = ["missing/"];
	expect(() => validatePlan(empty, "captured-target", regions, roles)).toThrow("matches no changed path");
});

test("a plan cannot substitute another artifact, collapse pass identities or select an unavailable role", () => {
	expect(() => validatePlan(plan(), "another-target", regions, roles)).toThrow("artifact");
	const duplicate = plan();
	duplicate.chunks[1]!.passes[0]!.id = "request-correctness";
	expect(() => validatePlan(duplicate, "captured-target", regions, roles)).toThrow("pass");
	duplicate.chunks[1]!.passes[0]!.id = "validator:request-correctness";
	expect(() => validatePlan(duplicate, "captured-target", regions, roles)).toThrow("Reserved pass identity");
	const unavailable = plan();
	unavailable.integration.role = "implementation-engineer";
	expect(() => validatePlan(unavailable, "captured-target", regions, roles)).toThrow("role");
});

test("declared risks inform the planner's depth without forcing a grid of passes", () => {
	const risky = plan();
	risky.chunks[1]!.risks.push({ kind: "reliability", reason: "Cancellation may race resource release." });
	risky.chunks[1]!.passes[0]!.lenses.push("reliability");
	expect(planPasses(validatePlan(risky, "captured-target", regions, roles), regions)).toHaveLength(3);
});

test("requested lenses are actual passes even when they inspect the same files", () => {
	expect(() => validatePlan(plan(), "captured-target", regions, roles, ["tenant isolation"])).toThrow(
		"tenant isolation",
	);
	const requested = plan();
	requested.chunks[0]!.passes.push({
		id: "tenant-check",
		role: "code-review-specialist",
		depth: "standard",
		lenses: ["tenant isolation"],
		questions: [
			{
				id: "tenant",
				question: "Can a selected ID escape its tenant?",
				verification: "Trace the authorization owner and its callers.",
			},
		],
	});
	expect(
		planPasses(validatePlan(requested, "captured-target", regions, roles, ["tenant isolation"]), regions).filter(
			(pass) => pass.chunk === "request",
		),
	).toHaveLength(2);
});

test("scopes can overlap on one file and unite a contract across directories", () => {
	const accepted = validatePlan(plan(), "captured-target", regions, roles);
	expect(planPasses(accepted, regions).map((pass) => ({ id: pass.id, regions: pass.regions }))).toEqual([
		{ id: "request-correctness", regions: ["api-request", "api-lifetime", "ui-request"] },
		{ id: "lifetime-correctness", regions: ["api-request", "api-lifetime"] },
		{ id: "integration", regions: ["api-request", "api-lifetime", "ui-request"] },
	]);
});
