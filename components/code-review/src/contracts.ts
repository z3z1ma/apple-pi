import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import type { ChangeRegion } from "./types.js";

export const REVIEW_PASS_CONCURRENCY = 8;

const text = Type.String({ minLength: 1, pattern: "\\S" });
const object = { additionalProperties: false } as const;
const question = Type.Object({ id: text, question: text, verification: text }, object);
const depth = Type.Union([Type.Literal("standard"), Type.Literal("deep")]);
const pass = Type.Object(
	{
		id: text,
		role: text,
		depth,
		lenses: Type.Array(text, { minItems: 1 }),
		questions: Type.Array(question, { minItems: 1 }),
	},
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
					paths: Type.Array(text, { minItems: 1 }),
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
		integration: Type.Object({ role: text, depth, questions: Type.Array(question, { minItems: 1 }) }, object),
	},
	object,
);
type LegacyPlan = { chunks: { regions?: string[] }[]; gaps?: { region: string; reason: string }[] };
export type ReviewPlan = Static<typeof ReviewPlanSchema> & LegacyPlan;
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

export function reviewReportSchema(pass: PlannedPass) {
	const coverage = ReviewReportSchema.properties.coverage.items;
	return Type.Object(
		{
			...ReviewReportSchema.properties,
			coverage: Type.Array(
				Type.Object(
					{
						...coverage.properties,
						question: Type.String({
							enum: pass.questions.map((entry) => entry.id),
							description: "The assigned question ID from pass.questions[].id, not the question text.",
						}),
					},
					object,
				),
			),
		},
		object,
	);
}

export const FindingValidationSchema = Type.Object(
	{
		artifact: text,
		summary: text,
		coverageGaps: Type.Array(Type.Object({ pass: text, question: text, reason: text }, object)),
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

function inScope(paths: readonly string[], file: string): boolean {
	return paths.some((path) => {
		const prefix = path.replace(/\/+$/, "");
		return prefix === "." || prefix === "" || file === prefix || file.startsWith(`${prefix}/`);
	});
}

export function chunkRegions(chunk: ReviewPlan["chunks"][number], regions: readonly ChangeRegion[]): string[] {
	return chunk.regions ?? regions.filter((region) => inScope(chunk.paths, region.path)).map((region) => region.id);
}

export function unscopedRegions(plan: ReviewPlan, regions: readonly ChangeRegion[]): string[] {
	const scoped = new Set(plan.chunks.flatMap((chunk) => chunkRegions(chunk, regions)));
	return regions.filter((region) => !scoped.has(region.id)).map((region) => region.id);
}

export function planPasses(plan: ReviewPlan, regions: readonly ChangeRegion[]): PlannedPass[] {
	return [
		...plan.chunks.flatMap((chunk) => {
			const owned = chunkRegions(chunk, regions);
			return chunk.passes.map((entry) => ({ ...entry, chunk: chunk.id, regions: owned, kind: "focused" as const }));
		}),
		{
			id: "integration",
			...plan.integration,
			lenses: ["integration"],
			chunk: null,
			regions: regions.map((region) => region.id),
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
	const plan = checkShape(ReviewPlanSchema, value) as ReviewPlan;
	if (plan.artifact !== artifact) throw new Error("The plan names a different artifact");
	unique(
		plan.chunks.map((chunk) => chunk.id),
		"chunk",
	);
	for (const chunk of plan.chunks)
		if (!chunkRegions(chunk, regions).length)
			throw new Error(`Scope ${chunk.id} matches no changed path: ${chunk.paths.join(", ")}`);
	const passes = planPasses(plan, regions);
	unique(
		passes.map((entry) => entry.id),
		"pass",
	);
	for (const entry of passes) {
		if (entry.id === "planner" || entry.id === "validator" || entry.id.startsWith("validator:"))
			throw new Error(`Reserved pass identity: ${entry.id}`);
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
	for (const gap of result.coverageGaps) {
		if (
			!reports.some(
				(report) => report.pass === gap.pass && report.coverage.some((entry) => entry.question === gap.question),
			)
		)
			throw new Error(`Unknown coverage gap: ${gap.pass}/${gap.question}`);
	}
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

export function validateShard(value: unknown, artifact: string, report: ReviewReport): FindingValidation {
	const result = checkShape(FindingValidationSchema, value);
	const keys = new Map(report.findings.map((finding) => [finding.id, findingKey(report.pass, finding.id)]));
	const key = (name: string) => keys.get(name) ?? name;
	return validateFindings(
		{
			...result,
			findings: result.findings.map((entry) => ({
				...entry,
				finding: key(entry.finding),
				duplicateOf: entry.duplicateOf === null ? null : key(entry.duplicateOf),
			})),
		},
		artifact,
		[report],
	);
}

export const DuplicateLinksSchema = Type.Object(
	{
		artifact: text,
		summary: text,
		duplicates: Type.Array(Type.Object({ finding: text, duplicateOf: text, reason: text }, object)),
	},
	object,
);

export function combineValidation(
	value: unknown,
	artifact: string,
	reports: ReviewReport[],
	shards: FindingValidation[],
): FindingValidation {
	if (value && typeof value === "object" && "findings" in value) return validateFindings(value, artifact, reports);
	const links = checkShape(DuplicateLinksSchema, value);
	if (links.artifact !== artifact) throw new Error("Duplicate links name a different artifact");
	const findings = shards.flatMap((shard) => shard.findings.map((entry) => ({ ...entry })));
	const byKey = new Map(findings.map((entry) => [entry.finding, entry]));
	for (const link of links.duplicates) {
		const entry = byKey.get(link.finding);
		if (!entry) throw new Error(`Duplicate link names an unknown finding: ${link.finding}`);
		if (!byKey.has(link.duplicateOf)) throw new Error(`Duplicate link targets an unknown finding: ${link.duplicateOf}`);
		entry.disposition = "duplicate";
		entry.duplicateOf = link.duplicateOf;
		entry.reason = link.reason;
	}
	return validateFindings(
		{
			artifact,
			summary: [links.summary, ...shards.map((shard) => shard.summary)].join("\n\n"),
			coverageGaps: shards.flatMap((shard) => shard.coverageGaps),
			findings,
			limitations: shards.flatMap((shard) => shard.limitations),
		},
		artifact,
		reports,
	);
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
