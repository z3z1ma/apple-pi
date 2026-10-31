import { expect, test } from "vitest";
import {
	planPasses,
	type ReviewPlan,
	type ReviewReport,
	validateFindings,
	validatePlan,
	validateReport,
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
				regions: ["api-request", "ui-request"],
				context: ["protocol.ts"],
				risks: [{ kind: "contract", reason: "The renderer and backend must agree." }],
				passes: [
					{
						id: "request-correctness",
						role: "code-review-specialist",
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
				regions: ["api-lifetime"],
				context: [],
				risks: [],
				passes: [
					{
						id: "lifetime-correctness",
						role: "code-review-specialist",
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
		gaps: [],
		integration: {
			role: "code-review-specialist",
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
	const pass = planPasses(plan())[0]!;
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
	const incomplete = { artifact: "captured-target", summary: "Challenge findings", findings: [], limitations: [] };
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

test("every region has exactly one primary owner or an explicit gap", () => {
	const missing = plan();
	missing.chunks[0]!.regions.pop();
	expect(() => validatePlan(missing, "captured-target", regions, roles)).toThrow("ui-request");
	missing.gaps.push({ region: "ui-request", reason: "The renderer contract is not understood yet." });
	expect(validatePlan(missing, "captured-target", regions, roles).gaps).toEqual(missing.gaps);
	const duplicate = plan();
	duplicate.chunks[1]!.regions.push("api-request");
	expect(() => validatePlan(duplicate, "captured-target", regions, roles)).toThrow("api-request");
	const invented = plan();
	invented.chunks[1]!.regions.push("not-a-region");
	expect(() => validatePlan(invented, "captured-target", regions, roles)).toThrow("not-a-region");
});

test("a plan cannot substitute another artifact, collapse pass identities or select an unavailable role", () => {
	expect(() => validatePlan(plan(), "another-target", regions, roles)).toThrow("artifact");
	const duplicate = plan();
	duplicate.chunks[1]!.passes[0]!.id = "request-correctness";
	expect(() => validatePlan(duplicate, "captured-target", regions, roles)).toThrow("pass");
	const unavailable = plan();
	unavailable.integration.role = "implementation-engineer";
	expect(() => validatePlan(unavailable, "captured-target", regions, roles)).toThrow("role");
});

test("a reliability risk changes required work instead of becoming only a label", () => {
	const risky = plan();
	risky.chunks[1]!.risks.push({ kind: "reliability", reason: "Cancellation may race resource release." });
	expect(() => validatePlan(risky, "captured-target", regions, roles)).toThrow("independent reliability");
	risky.chunks[1]!.passes.push({
		id: "cancel-reliability",
		role: "distributed-systems-researcher",
		lenses: ["reliability"],
		questions: [
			{
				id: "cancel",
				question: "Can cancellation release the resource twice?",
				verification: "Trace startup, interrupted and terminal states.",
			},
		],
	});
	const accepted = validatePlan(risky, "captured-target", regions, roles);
	expect(
		planPasses(accepted)
			.filter((pass) => pass.chunk === "lifetime")
			.map((pass) => pass.id),
	).toEqual(["lifetime-correctness", "cancel-reliability"]);
});

test("requested lenses are actual passes even when they inspect the same files", () => {
	expect(() => validatePlan(plan(), "captured-target", regions, roles, ["tenant isolation"])).toThrow(
		"tenant isolation",
	);
	const requested = plan();
	requested.chunks[0]!.passes.push({
		id: "tenant-check",
		role: "code-review-specialist",
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
		planPasses(validatePlan(requested, "captured-target", regions, roles, ["tenant isolation"])).filter(
			(pass) => pass.chunk === "request",
		),
	).toHaveLength(2);
});

test("a plan can split one file by behavior and unite a contract across directories", () => {
	const accepted = validatePlan(plan(), "captured-target", regions, roles);
	expect(planPasses(accepted).map((pass) => ({ id: pass.id, regions: pass.regions }))).toEqual([
		{ id: "request-correctness", regions: ["api-request", "ui-request"] },
		{ id: "lifetime-correctness", regions: ["api-lifetime"] },
		{ id: "integration", regions: ["api-request", "ui-request", "api-lifetime"] },
	]);
});
