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

const chunkFields = {
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
};

export const ReviewPlanSchema = Type.Object(
	{
		artifact: text,
		summary: text,
		chunks: Type.Array(Type.Object({ ...chunkFields, passes: Type.Array(pass, { minItems: 1 }) }, object)),
		integration: Type.Object({ role: text, depth, questions: Type.Array(question, { minItems: 1 }) }, object),
	},
	object,
);

const literals = (values: readonly string[]) => Type.Union(values.map((value) => Type.Literal(value)));

export function planToolSchema(roles: readonly string[]) {
	const role = literals(roles);
	return Type.Object(
		{
			summary: text,
			chunks: Type.Array(
				Type.Object(
					{ ...chunkFields, passes: Type.Array(Type.Object({ ...pass.properties, role }, object), { minItems: 1 }) },
					object,
				),
			),
			integration: Type.Object({ role, depth, questions: Type.Array(question, { minItems: 1 }) }, object),
		},
		object,
	);
}

export function planFromTool(value: unknown, artifact: string): unknown {
	return { ...(value as object), artifact };
}
type LegacyPlan = { chunks: { regions?: string[] }[]; gaps?: { region: string; reason: string }[] };
export type ReviewPlan = Static<typeof ReviewPlanSchema> & LegacyPlan;
export type PlannedPass = Static<typeof pass> & {
	chunk: string | null;
	regions: string[];
	kind: "focused" | "integration";
};

const finding = Type.Object(
	{
		id: text,
		title: text,
		path: text,
		line: Type.Integer({ minimum: 1 }),
		side: Type.Union([Type.Literal("before"), Type.Literal("after")]),
		severity: Type.Union([Type.Literal("critical"), Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
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
);
const extraPass = Type.Object({ reason: text, question: text, doneWhen: text }, object);

export const ReviewReportSchema = Type.Object(
	{
		artifact: text,
		pass: text,
		summary: text,
		coverage: Type.Array(
			Type.Object(
				{
					question: text,
					state: Type.Union([Type.Literal("completed"), Type.Literal("incomplete"), Type.Literal("unavailable")]),
					evidence: Type.Array(text),
					reason: Type.String(),
				},
				object,
			),
		),
		findings: Type.Array(finding),
		limitations: Type.Array(text),
		extraPasses: Type.Array(extraPass),
	},
	object,
);
export type ReviewReport = Static<typeof ReviewReportSchema>;

const answer = (description: string) =>
	Type.Union(
		[
			Type.Object({ state: Type.Literal("completed"), evidence: Type.Array(text, { minItems: 1 }) }, object),
			Type.Object({ state: Type.Literal("incomplete"), reason: text }, object),
			Type.Object({ state: Type.Literal("unavailable"), reason: text }, object),
		],
		{ description },
	);

export function reportToolSchema(pass: Pick<PlannedPass, "questions">) {
	return Type.Object(
		{
			summary: text,
			coverage: Type.Object(
				Object.fromEntries(pass.questions.map((entry) => [entry.id, answer(entry.question)])),
				object,
			),
			findings: Type.Array(finding),
			limitations: Type.Array(text),
			extraPasses: Type.Array(extraPass),
		},
		object,
	);
}

type ToolAnswer = { state: "completed"; evidence: string[] } | { state: "incomplete" | "unavailable"; reason: string };

export function reportFromTool(value: unknown, artifact: string, pass: Pick<PlannedPass, "id" | "questions">): unknown {
	const tool = value as Omit<ReviewReport, "artifact" | "pass" | "coverage"> & {
		coverage: Record<string, ToolAnswer>;
	};
	const taken = new Set(tool.findings.map((entry) => entry.id));
	const used = new Set<string>();
	const identity = (id: string) => {
		let next = id;
		for (let n = 2; used.has(next) || (next !== id && taken.has(next)); n++) next = `${id}-${n}`;
		used.add(next);
		return next;
	};
	return {
		artifact,
		pass: pass.id,
		summary: tool.summary,
		coverage: pass.questions.map((entry) => {
			const reply = tool.coverage[entry.id]!;
			return reply.state === "completed"
				? { question: entry.id, state: reply.state, evidence: reply.evidence, reason: "" }
				: { question: entry.id, state: reply.state, evidence: [], reason: reply.reason };
		}),
		findings: tool.findings.map((entry) => ({ ...entry, id: identity(entry.id) })),
		limitations: tool.limitations,
		extraPasses: tool.extraPasses,
	};
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

export function validateReport(value: unknown, artifact: string, pass: PlannedPass): ReviewReport {
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
		if (entry.state !== "completed" && !entry.reason.trim())
			throw new Error(`An unanswered question needs a reason: ${entry.question}`);
	}
	if (expected.size) throw new Error(`Missing question coverage: ${[...expected].join(", ")}`);
	unique(
		report.findings.map((finding) => finding.id),
		"finding",
	);
	return report;
}

export function findingKey(pass: string, finding: string): string {
	return `${encodeURIComponent(pass)}:${encodeURIComponent(finding)}`;
}

export const DuplicateLinksSchema = Type.Object(
	{
		artifact: text,
		summary: Type.String(),
		duplicates: Type.Array(Type.Object({ finding: text, duplicateOf: text, reason: text }, object)),
	},
	object,
);
export type DuplicateLinks = Static<typeof DuplicateLinksSchema>;

export function duplicateToolSchema(keys: readonly string[]) {
	const key = literals(keys);
	return Type.Object(
		{
			summary: text,
			duplicates: Type.Array(Type.Object({ finding: key, duplicateOf: key, reason: text }, object)),
		},
		object,
	);
}

export function linksFromTool(value: unknown, artifact: string, reports: ReviewReport[]): unknown {
	const links = checkShape(DuplicateLinksSchema, { ...(value as object), artifact });
	return assessFindings(artifact, reports, links);
}

export function validateAssessment(value: unknown, artifact: string): FindingValidation {
	const assessment = checkShape(FindingValidationSchema, value);
	if (assessment.artifact !== artifact) throw new Error("The assessment names a different artifact");
	return assessment;
}

export function assessFindings(
	artifact: string,
	reports: ReviewReport[],
	links: DuplicateLinks | null,
): FindingValidation {
	const findings = reports.flatMap((report) =>
		report.findings.map((entry) => ({
			finding: findingKey(report.pass, entry.id),
			disposition: entry.certainty === "hypothesis" ? ("unresolved" as const) : ("confirmed" as const),
			reason:
				entry.certainty === "hypothesis"
					? `Pass ${report.pass} reported this as a hypothesis without a reproduction.`
					: `Pass ${report.pass} reported this with ${entry.certainty} certainty; no separate validator re-ran it.`,
			evidence: [`The finding's own evidence: ${entry.evidence.map((item) => item.kind).join(", ")}.`],
			duplicateOf: null as string | null,
		})),
	);
	const byKey = new Map<string, FindingValidation["findings"][number]>(findings.map((entry) => [entry.finding, entry]));
	const reaches = (from: string, target: string) => {
		const visited = new Set<string>();
		for (let next: string | null = from; next; next = byKey.get(next)?.duplicateOf ?? null) {
			if (next === target) return true;
			if (visited.has(next)) return false;
			visited.add(next);
		}
		return false;
	};
	const root = (key: string) => {
		const visited = new Set<string>();
		let next = key;
		while (byKey.get(next)?.duplicateOf && !visited.has(next)) {
			visited.add(next);
			next = byKey.get(next)!.duplicateOf!;
		}
		return next;
	};
	for (const link of links?.duplicates ?? []) {
		if (!byKey.has(link.finding) || !byKey.has(link.duplicateOf)) continue;
		const inverted =
			byKey.get(link.finding)!.disposition === "confirmed" &&
			byKey.get(root(link.duplicateOf))!.disposition === "unresolved";
		const duplicate = inverted ? root(link.duplicateOf) : link.finding;
		const original = inverted ? link.finding : link.duplicateOf;
		const entry = byKey.get(duplicate)!;
		if (entry.disposition === "duplicate" || reaches(original, duplicate)) continue;
		Object.assign(entry, { disposition: "duplicate", duplicateOf: original, reason: link.reason });
	}
	return { artifact, summary: links?.summary ?? "", coverageGaps: [], findings, limitations: [] };
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
