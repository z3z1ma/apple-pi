import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import type { ChangeRegion } from "./types.js";

const text = Type.String({ minLength: 1, pattern: "\\S" });
const object = { additionalProperties: false } as const;
const question = Type.Object({ id: text, question: text, verification: text }, object);
const pass = Type.Object(
	{ id: text, role: text, lenses: Type.Array(text, { minItems: 1 }), questions: Type.Array(question, { minItems: 1 }) },
	object,
);

export const ReviewPlanSchema = Type.Object(
	{
		artifact: text,
		summary: text,
		chunks: Type.Array(
			Type.Object(
				{
					id: text,
					title: text,
					regions: Type.Array(text, { minItems: 1 }),
					context: Type.Array(text),
					risks: Type.Array(
						Type.Object(
							{
								kind: Type.Union([
									Type.Literal("contract"),
									Type.Literal("reliability"),
									Type.Literal("authority"),
									Type.Literal("compatibility"),
									Type.Literal("usability"),
									Type.Literal("uncertainty"),
								]),
								reason: text,
							},
							object,
						),
					),
					passes: Type.Array(pass, { minItems: 1 }),
				},
				object,
			),
		),
		gaps: Type.Array(Type.Object({ region: text, reason: text }, object)),
		integration: Type.Object({ role: text, questions: Type.Array(question, { minItems: 1 }) }, object),
	},
	object,
);
export type ReviewPlan = Static<typeof ReviewPlanSchema>;
export type PlannedPass = Static<typeof pass> & {
	chunk: string | null;
	regions: string[];
	kind: "focused" | "integration";
};

export const ReviewReportSchema = Type.Object(
	{
		artifact: text,
		pass: text,
		summary: text,
		coverage: Type.Array(
			Type.Object(
				{
					question: text,
					state: Type.Union([Type.Literal("completed"), Type.Literal("incomplete")]),
					evidence: Type.Array(text),
					reason: Type.String(),
				},
				object,
			),
		),
		findings: Type.Array(
			Type.Object(
				{
					id: text,
					title: text,
					path: text,
					line: Type.Integer({ minimum: 1 }),
					side: Type.Union([Type.Literal("before"), Type.Literal("after")]),
					severity: Type.Union([
						Type.Literal("critical"),
						Type.Literal("high"),
						Type.Literal("medium"),
						Type.Literal("low"),
					]),
					certainty: Type.Union([Type.Literal("confirmed"), Type.Literal("probable"), Type.Literal("hypothesis")]),
					trigger: text,
					invariant: text,
					impact: text,
					cause: text,
					correction: text,
					evidence: Type.Array(
						Type.Object(
							{
								kind: Type.Union([Type.Literal("source"), Type.Literal("reproduced"), Type.Literal("hypothesis")]),
								detail: text,
								provenance: text,
							},
							object,
						),
						{ minItems: 1 },
					),
					counterevidence: Type.String(),
				},
				object,
			),
		),
		limitations: Type.Array(text),
		extraPasses: Type.Array(Type.Object({ reason: text, question: text, doneWhen: text }, object)),
	},
	object,
);
export type ReviewReport = Static<typeof ReviewReportSchema>;

export const FindingValidationSchema = Type.Object(
	{
		artifact: text,
		summary: text,
		findings: Type.Array(
			Type.Object(
				{
					finding: text,
					disposition: Type.Union([
						Type.Literal("confirmed"),
						Type.Literal("rejected"),
						Type.Literal("unresolved"),
						Type.Literal("duplicate"),
					]),
					reason: text,
					evidence: Type.Array(text, { minItems: 1 }),
					duplicateOf: Type.Union([text, Type.Null()]),
				},
				object,
			),
		),
		limitations: Type.Array(text),
	},
	object,
);
export type FindingValidation = Static<typeof FindingValidationSchema>;

export function planPasses(plan: ReviewPlan): PlannedPass[] {
	return [
		...plan.chunks.flatMap((chunk) =>
			chunk.passes.map((entry) => ({ ...entry, chunk: chunk.id, regions: chunk.regions, kind: "focused" as const })),
		),
		{
			id: "integration",
			...plan.integration,
			lenses: ["integration"],
			chunk: null,
			regions: [...plan.chunks.flatMap((chunk) => chunk.regions), ...plan.gaps.map((gap) => gap.region)],
			kind: "integration",
		},
	];
}

export function validatePlan(
	value: unknown,
	artifact: string,
	regions: ChangeRegion[],
	roles: ReadonlySet<string>,
	lenses: readonly string[] = [],
): ReviewPlan {
	const plan = checkShape(ReviewPlanSchema, value);
	if (plan.artifact !== artifact) throw new Error("The plan names a different artifact");
	const owners = new Map(regions.map((region) => [region.id, 0]));
	const claim = (id: string) => {
		const count = owners.get(id);
		if (count === undefined) throw new Error(`Unknown region: ${id}`);
		if (count) throw new Error(`Region has more than one primary owner: ${id}`);
		owners.set(id, count + 1);
	};
	unique(
		plan.chunks.map((chunk) => chunk.id),
		"chunk",
	);
	for (const chunk of plan.chunks) {
		for (const region of chunk.regions) claim(region);
		const baseline = chunk.passes.filter((entry) => entry.lenses.includes("correctness"));
		if (!baseline.length) throw new Error(`Chunk ${chunk.id} needs a correctness pass`);
		for (const risk of chunk.risks) {
			if (risk.kind === "reliability" || risk.kind === "authority") {
				if (
					!chunk.passes.some(
						(entry) => entry.lenses.includes(risk.kind) && baseline.some((other) => other.id !== entry.id),
					)
				)
					throw new Error(`Chunk ${chunk.id} needs an independent ${risk.kind} pass`);
			} else if (
				(risk.kind === "compatibility" || risk.kind === "usability") &&
				!chunk.passes.some((entry) => entry.lenses.includes(risk.kind))
			) {
				throw new Error(`Chunk ${chunk.id} needs ${risk.kind} evidence obligations`);
			}
		}
	}
	for (const gap of plan.gaps) claim(gap.region);
	const missing = [...owners].filter(([, count]) => count === 0).map(([id]) => id);
	if (missing.length) throw new Error(`Unassigned review regions: ${missing.join(", ")}`);
	const passes = planPasses(plan);
	unique(
		passes.map((entry) => entry.id),
		"pass",
	);
	for (const entry of passes) {
		if (entry.id === "planner" || entry.id === "validator") throw new Error(`Reserved pass identity: ${entry.id}`);
		if (!roles.has(entry.role)) throw new Error(`Unavailable advisory review role: ${entry.role}`);
		unique(
			entry.questions.map((question) => question.id),
			`question in ${entry.id}`,
		);
	}
	for (const lens of lenses)
		if (!passes.some((entry) => entry.lenses.includes(lens)))
			throw new Error(`Requested lens is not assigned: ${lens}`);
	return plan;
}

export function validateReport(
	value: unknown,
	artifact: string,
	pass: PlannedPass,
	paths: ReadonlySet<string>,
): ReviewReport {
	const report = checkShape(ReviewReportSchema, value);
	if (report.artifact !== artifact || report.pass !== pass.id)
		throw new Error("The report names a different artifact or pass");
	unique(
		report.coverage.map((entry) => entry.question),
		"coverage question",
	);
	const expected = new Set(pass.questions.map((entry) => entry.id));
	for (const entry of report.coverage) {
		if (!expected.delete(entry.question)) throw new Error(`Unknown coverage question: ${entry.question}`);
		if (entry.state === "completed" && !entry.evidence.length)
			throw new Error(`Completed question has no evidence: ${entry.question}`);
		if (entry.state === "incomplete" && !entry.reason.trim())
			throw new Error(`Incomplete question needs a reason: ${entry.question}`);
	}
	if (expected.size) throw new Error(`Missing question coverage: ${[...expected].join(", ")}`);
	unique(
		report.findings.map((finding) => finding.id),
		"finding",
	);
	for (const finding of report.findings)
		if (!paths.has(finding.path)) throw new Error(`Finding location is not in captured source: ${finding.path}`);
	return report;
}

export function findingKey(pass: string, finding: string): string {
	return `${encodeURIComponent(pass)}:${encodeURIComponent(finding)}`;
}

export function validateFindings(value: unknown, artifact: string, reports: ReviewReport[]): FindingValidation {
	const result = checkShape(FindingValidationSchema, value);
	if (result.artifact !== artifact) throw new Error("Finding validation names a different artifact");
	const expected = new Set(
		reports.flatMap((report) => report.findings.map((finding) => findingKey(report.pass, finding.id))),
	);
	unique(
		result.findings.map((entry) => entry.finding),
		"finding disposition",
	);
	for (const entry of result.findings) {
		if (!expected.delete(entry.finding)) throw new Error(`Unknown finding disposition: ${entry.finding}`);
		if (entry.disposition !== "duplicate" && entry.duplicateOf !== null)
			throw new Error(`Only a duplicate can point to another finding: ${entry.finding}`);
	}
	if (expected.size) throw new Error(`Missing finding dispositions: ${[...expected].join(", ")}`);
	const decisions = new Map(result.findings.map((entry) => [entry.finding, entry]));
	for (const entry of result.findings) {
		const visited = new Set<string>();
		let next: typeof entry | undefined = entry;
		while (next?.disposition === "duplicate") {
			if (visited.has(next.finding)) throw new Error("Duplicate findings form a cycle");
			visited.add(next.finding);
			next = decisions.get(next.duplicateOf ?? "");
			if (!next) throw new Error(`Duplicate names an unknown finding: ${entry.finding}`);
		}
	}
	return result;
}

function unique(ids: string[], kind: string): void {
	if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${kind} identity`);
}

export function checkShape<T extends TSchema>(schema: T, value: unknown): Static<T> {
	if (!Value.Check(schema, value)) {
		const errors = [...Value.Errors(schema, value)].map((error) => `${error.instancePath || "/"}: ${error.message}`);
		throw new Error(`Invalid review output: ${errors.join("; ")}`);
	}
	return value as Static<T>;
}
