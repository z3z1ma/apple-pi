import { createHash } from "node:crypto";
import { isAbsolute, normalize, sep } from "node:path";
import type { PlannerOutput, ReviewItem, ReviewProfile, ReviewWorkGraph } from "./types.js";

export class ReviewGraphError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = "ReviewGraphError";
	}
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function safeRelativePath(path: string): boolean {
	if (isAbsolute(path)) return false;
	const clean = normalize(path).split(sep).join("/");
	return clean !== ".." && !clean.startsWith("../") && clean !== ".git" && !clean.startsWith(".git/");
}

export function compileReviewWorkGraph(
	output: PlannerOutput,
	items: ReviewItem[],
	profile: ReviewProfile,
	maxGroups: number,
): ReviewWorkGraph {
	if (output.groups.length === 0) throw new ReviewGraphError("Planner returned no review groups", "empty_graph");
	if (output.groups.length > maxGroups)
		throw new ReviewGraphError(
			`Planner returned ${output.groups.length} groups; maximum is ${maxGroups}`,
			"too_many_groups",
		);
	const expected = new Set(items.map((item) => item.id));
	const assigned = new Map<string, string>();
	const groupIds = new Set<string>();
	const groups = output.groups.map((group, index) => {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(group.id)) {
			throw new ReviewGraphError(`Invalid group ID at groups[${index}]: ${group.id}`, "invalid_group_id");
		}
		if (groupIds.has(group.id)) throw new ReviewGraphError(`Duplicate group ID: ${group.id}`, "duplicate_group_id");
		groupIds.add(group.id);
		if (group.itemIds.length === 0)
			throw new ReviewGraphError(`Review group ${group.id} has no focus items`, "empty_group");
		for (const id of group.itemIds) {
			if (!expected.has(id))
				throw new ReviewGraphError(`Review group ${group.id} invented item ID ${id}`, "unknown_item");
			const prior = assigned.get(id);
			if (prior)
				throw new ReviewGraphError(`Review item ${id} appears in both ${prior} and ${group.id}`, "duplicate_item");
			assigned.set(id, group.id);
		}
		for (const path of group.contextPaths) {
			if (!safeRelativePath(path))
				throw new ReviewGraphError(`Review group ${group.id} has unsafe context path: ${path}`, "unsafe_context_path");
		}
		return {
			...group,
			itemIds: [...group.itemIds],
			contextPaths: [...new Set(group.contextPaths)],
			tier: profile === "fast" ? ("fast" as const) : profile === "thorough" ? ("strong" as const) : group.tier,
		};
	});
	const missing = items.filter((item) => !assigned.has(item.id));
	if (missing.length > 0) {
		throw new ReviewGraphError(
			`Planner omitted review items: ${missing.map((item) => item.path).join(", ")}`,
			"missing_items",
		);
	}
	const canonical = JSON.stringify({ summary: output.summary, groups });
	return { summary: output.summary, groups, graphHash: sha256(canonical) };
}
