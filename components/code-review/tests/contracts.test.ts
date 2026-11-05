import { Value } from "typebox/value";
import { expect, test } from "vitest";
import {
	assessFindings,
	assessmentFromTool,
	duplicateToolSchema,
	findingKey,
	planFromTool,
	planPasses,
	planToolSchema,
	type ReviewPlan,
	type ReviewReport,
	reportFromTool,
	reportToolSchema,
	unscopedRegions,
	validatePlan,
	validateReport,
} from "../src/contracts.js";
import { INSPECT_REVIEW } from "../src/prompts.js";
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

const finding = (id: string, certainty: "confirmed" | "probable" | "hypothesis" = "confirmed") => ({
	id,
	title: "Consent changes after selection",
	path: "api.ts",
	line: 10,
	side: "after" as const,
	severity: "high" as const,
	certainty,
	trigger: "The roster changes while a request waits.",
	invariant: "Selection must stay fixed.",
	impact: "An unintended person can be selected.",
	cause: "The backend expands the roster again.",
	correction: "Retain the selected identifiers.",
	evidence: [
		{ kind: "source" as const, detail: "api.ts:10 expands the current roster.", provenance: "captured source" },
	],
	counterevidence: "No caller guard was found.",
});

test("a report accounts for every question and cannot claim completed coverage without evidence", () => {
	const pass = planPasses(plan(), regions)[0]!;
	expect(validateReport(report(), "captured-target", pass).coverage[0]!.state).toBe("completed");
	const missing = report();
	missing.coverage = [];
	expect(() => validateReport(missing, "captured-target", pass)).toThrow("Missing question");
	const unsupported = report();
	unsupported.coverage[0]!.evidence = [];
	expect(() => validateReport(unsupported, "captured-target", pass)).toThrow("no evidence");
	unsupported.coverage[0]!.state = "unavailable";
	unsupported.coverage[0]!.reason = "The check needs a live provider.";
	expect(validateReport(unsupported, "captured-target", pass).coverage[0]!.state).toBe("unavailable");
	expect(() => validateReport(report(), "new-target", pass)).toThrow("different artifact");
});

test("the inspection tool takes one answer per planned question, so a reviewer cannot invent, skip or leave one unexplained", () => {
	const pass = planPasses(plan(), regions)[0]!;
	const schema = reportToolSchema(pass);
	const reply = {
		summary: "The source trace preserves selected IDs.",
		coverage: { consent: { state: "completed", evidence: ["api.ts:10 forwards the selected IDs."] } },
		findings: [finding("roster"), finding("roster")],
		limitations: [],
		extraPasses: [],
	};
	expect(Value.Check(schema, reply)).toBe(true);
	expect(
		Value.Check(schema, { ...reply, coverage: { ...reply.coverage, "standards-and-intent": reply.coverage.consent } }),
	).toBe(false);
	expect(Value.Check(schema, { ...reply, coverage: {} })).toBe(false);
	expect(Value.Check(schema, { ...reply, coverage: { consent: { state: "completed", evidence: [] } } })).toBe(false);
	expect(
		Value.Check(schema, { ...reply, coverage: { consent: { state: "unavailable", reason: "Needs Docker." } } }),
	).toBe(true);
	const stored = validateReport(reportFromTool(reply, "captured-target", pass), "captured-target", pass);
	expect(stored).toMatchObject({ artifact: "captured-target", pass: "request-correctness" });
	expect(stored.coverage).toEqual([
		{ question: "consent", state: "completed", evidence: ["api.ts:10 forwards the selected IDs."], reason: "" },
	]);
	expect(stored.findings.map((entry) => entry.id)).toEqual(["roster", "roster-2"]);
});

test("repeated finding IDs get fresh identities that never collide with supplied ones", () => {
	const pass = planPasses(plan(), regions)[0]!;
	const ids = (supplied: string[]) =>
		(
			reportFromTool(
				{
					summary: "s",
					coverage: { consent: { state: "completed", evidence: ["e"] } },
					findings: supplied.map((id) => finding(id)),
					limitations: [],
					extraPasses: [],
				},
				"captured-target",
				pass,
			) as ReviewReport
		).findings.map((entry) => entry.id);
	expect(ids(["bug", "bug", "bug-2"])).toEqual(["bug", "bug-3", "bug-2"]);
	expect(ids(["bug", "bug-2", "bug"])).toEqual(["bug", "bug-2", "bug-3"]);
	expect(ids(["bug", "bug", "bug"])).toEqual(["bug", "bug-2", "bug-3"]);
});

test("inspectors are told that evidence unavailable here is an unavailable answer", () => {
	expect(INSPECT_REVIEW).toContain("answer unavailable");
	expect(INSPECT_REVIEW).not.toMatch(/unavailable[^.]*belongs in incomplete/i);
});

test("the planner chooses only supplied roles and never repeats the artifact", () => {
	const { artifact: _, ...reply } = plan();
	const schema = planToolSchema([...roles]);
	expect(Value.Check(schema, reply)).toBe(true);
	expect(Value.Check(schema, { ...reply, integration: { ...reply.integration, role: "invented-role" } })).toBe(false);
	expect(validatePlan(planFromTool(reply, "captured-target"), "captured-target", regions, roles).artifact).toBe(
		"captured-target",
	);
});

test("findings stand as reported, hypotheses stay unresolved, and only sound duplicate links apply", () => {
	const first = report();
	first.findings = [finding("first"), finding("second"), finding("guess", "hypothesis")];
	const keys = first.findings.map((entry) => findingKey(first.pass, entry.id));
	expect(
		Value.Check(duplicateToolSchema(keys), {
			summary: "One pair",
			duplicates: [{ finding: "x", duplicateOf: keys[0], reason: "r" }],
		}),
	).toBe(false);
	const assessed = assessFindings("captured-target", [first], {
		artifact: "captured-target",
		summary: "One pair.",
		duplicates: [
			{ finding: keys[1]!, duplicateOf: keys[0]!, reason: "Same trigger, invariant and cause." },
			{ finding: keys[0]!, duplicateOf: keys[1]!, reason: "A cycle back." },
			{ finding: keys[2]!, duplicateOf: keys[2]!, reason: "Itself." },
		],
	});
	expect(assessed.findings.map((entry) => [entry.disposition, entry.duplicateOf])).toEqual([
		["confirmed", null],
		["duplicate", keys[0]],
		["unresolved", null],
	]);
	expect(assessFindings("captured-target", [first], null).findings.map((entry) => entry.disposition)).toEqual([
		"confirmed",
		"confirmed",
		"unresolved",
	]);
	const toHypothesis = assessmentFromTool(
		{ summary: "One pair.", duplicates: [{ finding: keys[0]!, duplicateOf: keys[2]!, reason: "Same defect." }] },
		"captured-target",
		[first],
	) as ReturnType<typeof assessFindings>;
	expect(toHypothesis.findings.map((entry) => [entry.disposition, entry.duplicateOf])).toEqual([
		["confirmed", null],
		["confirmed", null],
		["duplicate", keys[0]],
	]);
	expect(toHypothesis).toMatchObject({ artifact: "captured-target", summary: "One pair." });
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
