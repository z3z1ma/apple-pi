import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	FindingValidation,
	PlannedPass,
	ReviewPlan,
	ReviewReport,
} from "../../components/code-review/src/contracts.js";

export type ReviewInput = { artifact: { digest: string } } & (
	| {
			phase: "planning";
			regions: { id: string }[];
			additionalWork?: { id: string; question: string; doneWhen: string }[];
	  }
	| { phase: "inspection"; pass: PlannedPass }
	| { phase: "validation"; reports: ReviewReport[] }
);
export interface ReviewSettings {
	authority?: boolean;
	partial?: boolean;
	otherReport?: string;
	passId?: string;
	challenged?: boolean;
	finding?: boolean;
	rejectFinding?: boolean;
}

export function reviewReply(
	input: ReviewInput,
	settings: ReviewSettings = {},
): ReviewPlan | ReviewReport | FindingValidation {
	const summary = readFileSync(join(process.cwd(), "value.ts"), "utf8").trim();
	if (input.phase === "planning") {
		const plan: ReviewPlan = {
			artifact: input.artifact.digest,
			summary,
			chunks: [
				{
					id: "value",
					title: "Export the requested value",
					regions: input.regions.map((region) => region.id),
					context: [],
					risks: [],
					passes: [
						{
							id: settings.passId ?? "value-correctness",
							role: "code-review-specialist",
							lenses: ["correctness"],
							questions: [
								{
									id: "value",
									question: "Does the exported value match intent?",
									verification: "Read the captured value and its callers.",
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
						id: "integration",
						question: "Do consumers still agree with the exported value?",
						verification: "Trace the whole captured change.",
					},
				],
			},
		};
		for (const request of input.additionalWork ?? []) {
			plan.chunks[0]!.passes.push({
				id: request.id,
				role: "code-review-specialist",
				lenses: [request.id],
				questions: [{ id: "additional", question: request.question, verification: request.doneWhen }],
			});
		}
		if (settings.authority) {
			plan.chunks[0]!.risks.push({ kind: "authority", reason: "The change removes stored records." });
			plan.chunks[0]!.passes.push({
				id: "deletion-authority",
				role: "code-review-specialist",
				lenses: ["authority"],
				questions: [
					{
						id: "permission",
						question: "Who may remove these records?",
						verification: "Trace admission through the actual deletion.",
					},
				],
			});
		}
		return plan;
	}
	if (input.phase === "inspection")
		return {
			artifact: input.artifact.digest,
			pass: input.pass.id,
			summary: summary + (input.pass.kind === "focused" && settings.otherReport ? `\n${settings.otherReport}` : ""),
			coverage: input.pass.questions.map((question) => ({
				question: question.id,
				state: settings.partial ? "incomplete" : "completed",
				evidence: settings.partial ? [] : [summary],
				reason: settings.partial ? "The required service is unavailable." : "",
			})),
			findings:
				settings.finding && input.pass.kind === "focused"
					? [
							{
								id: "mismatch",
								title: "The value disagrees with its consumer",
								path: "value.ts",
								line: 1,
								side: "after",
								severity: "high",
								certainty: "probable",
								trigger: "A consumer requests the original value.",
								invariant: "The exported value and consumer must agree.",
								impact: "The consumer takes the wrong branch.",
								cause: "The export changes without its consumer.",
								correction: "Update the dependent contract together.",
								evidence: [{ kind: "source", detail: summary, provenance: "Captured value.ts" }],
								counterevidence: "No consumer execution was attempted by this scripted fixture.",
							},
						]
					: [],
			limitations: [],
			extraPasses: [],
		};
	return {
		artifact: input.artifact.digest,
		summary,
		findings: input.reports.flatMap((report) =>
			report.findings.map((finding) => ({
				finding: `${encodeURIComponent(report.pass)}:${encodeURIComponent(finding.id)}`,
				disposition: settings.rejectFinding ? ("rejected" as const) : ("confirmed" as const),
				reason: settings.rejectFinding
					? "Scripted counterevidence rejects this allegation."
					: "The scripted challenge retains this allegation.",
				evidence: [summary],
				duplicateOf: null,
			})),
		),
		coverageGaps: settings.challenged
			? [
					{
						pass: input.reports[0]!.pass,
						question: input.reports[0]!.coverage[0]!.question,
						reason: "The claimed consumer check has no supporting trace.",
					},
				]
			: [],
		limitations: [],
	};
}
