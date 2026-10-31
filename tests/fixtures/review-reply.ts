import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	FindingValidation,
	PlannedPass,
	ReviewPlan,
	ReviewReport,
} from "../../components/code-review/src/contracts.js";

export type ReviewInput = { artifact: { digest: string } } & (
	| { phase: "planning"; regions: { id: string }[] }
	| { phase: "inspection"; pass: PlannedPass }
	| { phase: "validation"; reports: ReviewReport[] }
);
export interface ReviewSettings {
	authority?: boolean;
	partial?: boolean;
	otherReport?: string;
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
							id: "value-correctness",
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
			findings: [],
			limitations: [],
			extraPasses: [],
		};
	return { artifact: input.artifact.digest, summary, findings: [], coverageGaps: [], limitations: [] };
}
