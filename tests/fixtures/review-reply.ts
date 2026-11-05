import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlannedPass, ReviewPlan } from "../../components/code-review/src/contracts.js";

export type ReviewInput = { artifact: { digest: string } } & (
	| {
			phase: "planning";
			regions: { id: string; path: string }[];
			additionalWork?: { id: string; question: string; doneWhen: string }[];
	  }
	| { phase: "inspection"; pass: PlannedPass }
	| { phase: "validation"; findings: { key: string }[] }
);
export interface ReviewSettings {
	authority?: boolean;
	partial?: boolean;
	partialPass?: string;
	unavailable?: boolean;
	otherReport?: string;
	passId?: string;
	finding?: boolean;
	duplicate?: boolean;
}

export function reviewReply(input: ReviewInput, settings: ReviewSettings = {}): unknown {
	const summary = readFileSync(join(process.cwd(), "value.ts"), "utf8").trim();
	if (input.phase === "planning") {
		const plan: Omit<ReviewPlan, "artifact"> = {
			summary,
			chunks: [
				{
					id: "value",
					title: "Export the requested value",
					paths: [...new Set(input.regions.map((region) => region.path))],
					context: [],
					risks: [],
					passes: [
						{
							id: settings.passId ?? "value-correctness",
							role: "code-review-specialist",
							depth: "standard",
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
			integration: {
				role: "code-review-specialist",
				depth: "deep",
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
				depth: "standard",
				lenses: [request.id],
				questions: [{ id: "additional", question: request.question, verification: request.doneWhen }],
			});
		}
		if (settings.authority) {
			plan.chunks[0]!.risks.push({ kind: "authority", reason: "The change removes stored records." });
			plan.chunks[0]!.passes.push({
				id: "deletion-authority",
				role: "code-review-specialist",
				depth: "standard",
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
			summary: summary + (input.pass.kind === "focused" && settings.otherReport ? `\n${settings.otherReport}` : ""),
			coverage: Object.fromEntries(
				input.pass.questions.map((question) => [
					question.id,
					settings.partial || settings.partialPass === input.pass.id
						? { state: "incomplete", reason: "The scripted inspection stopped before settling this." }
						: settings.unavailable
							? { state: "unavailable", reason: "The required service is not reachable from this machine." }
							: { state: "completed", evidence: [summary] },
				]),
			),
			findings:
				settings.finding && (input.pass.kind === "focused" || settings.duplicate)
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
	const [first, ...rest] = input.findings;
	return {
		summary,
		duplicates: rest.map((entry) => ({
			finding: entry.key,
			duplicateOf: first!.key,
			reason: "The scripted passes report the same trigger, invariant and cause.",
		})),
	};
}
