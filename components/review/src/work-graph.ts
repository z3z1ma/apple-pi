import { createHash } from "node:crypto";
import type { OpenReviewCall, ReviewCycleRecord, ReviewFocus, ReviewItem, ReviewPartition } from "./types.js";

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

export function reviewItemAliases(items: ReviewItem[]): Map<string, string> {
	const pathCounts = new Map<string, number>();
	for (const item of items) pathCounts.set(item.path, (pathCounts.get(item.path) ?? 0) + 1);
	const ids = new Set(items.map((item) => item.id));
	return new Map(
		items.map((item) => {
			let alias = (pathCounts.get(item.path) ?? 0) > 1 ? `${item.path} (${item.status})` : item.path;
			if (alias !== item.id && ids.has(alias)) alias = `${item.path} (${item.status})`;
			return [item.id, alias];
		}),
	);
}

export function resolveReviewItemRef(ref: string, items: ReviewItem[]): string {
	const aliases = reviewItemAliases(items);
	const matches = items.filter((item) => item.id === ref || aliases.get(item.id) === ref);
	if (matches.length === 1) return matches[0].id;
	if (matches.length > 1) throw new ReviewGraphError(`Ambiguous item reference: ${ref}`, "ambiguous_item");
	throw new ReviewGraphError(`Unknown item ID: ${ref}`, "unknown_item");
}

export function focusIdentityKey(itemIds: string[], question: string): string {
	return `${[...itemIds].sort().join("\0")}\0${question.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

export function compileReviewCycle(
	calls: OpenReviewCall[],
	items: ReviewItem[],
	cycle: number,
	limits: { maxFocuses: number },
	priorKeys: Set<string>,
): ReviewCycleRecord {
	if (calls.length === 0) throw new ReviewGraphError("Planner opened no reviews", "empty_graph");
	const partitions: ReviewPartition[] = [];
	const focuses: ReviewFocus[] = [];
	const seenKeys = new Set(priorKeys);
	let focusCount = 0;
	for (const [partitionIndex, call] of calls.entries()) {
		if (call.focuses.length === 0)
			throw new ReviewGraphError(`open_review[${partitionIndex}] has no focuses`, "empty_focuses");
		if (call.files.length === 0)
			throw new ReviewGraphError(`open_review[${partitionIndex}] has no files`, "empty_partition");
		const itemIds: string[] = [];
		const seenItems = new Set<string>();
		for (const ref of call.files) {
			const id = resolveReviewItemRef(ref, items);
			if (seenItems.has(id))
				throw new ReviewGraphError(`open_review[${partitionIndex}] repeats ${ref}`, "duplicate_partition_item");
			seenItems.add(id);
			itemIds.push(id);
		}
		const partitionId = `c${cycle}-p${partitionIndex + 1}`;
		const partition: ReviewPartition = {
			id: partitionId,
			cycle,
			title: call.title?.trim() || `Partition ${partitionIndex + 1}`,
			itemIds,
		};
		partitions.push(partition);
		for (const [focusIndex, proposed] of call.focuses.entries()) {
			focusCount++;
			if (focusCount > limits.maxFocuses)
				throw new ReviewGraphError(
					`Planner opened ${focusCount} focuses; maximum is ${limits.maxFocuses}`,
					"too_many_focuses",
				);
			if (!proposed.title.trim() || !proposed.question.trim())
				throw new ReviewGraphError(`Focus ${partitionId}/${focusIndex} is missing a title or question`, "empty_focus");
			if (proposed.checks.length === 0 || proposed.checks.some((check) => !check.trim()))
				throw new ReviewGraphError(`Focus ${partitionId}/${focusIndex} has empty checks`, "empty_checks");
			const key = focusIdentityKey(itemIds, proposed.question);
			if (seenKeys.has(key))
				throw new ReviewGraphError(
					`Focus repeats a previous investigation of the same files: ${proposed.title}`,
					"duplicate_focus",
				);
			seenKeys.add(key);
			focuses.push({
				id: `${partitionId}-f${focusIndex + 1}`,
				partitionId,
				cycle,
				title: proposed.title.trim(),
				question: proposed.question.trim(),
				checks: proposed.checks.map((check) => check.trim()),
				itemIds: [...itemIds],
			});
		}
	}
	return { index: cycle, partitions, focuses };
}

export function workGraphHash(cycles: ReviewCycleRecord[]): string {
	return sha256(
		JSON.stringify(
			cycles.map((cycle) => ({
				index: cycle.index,
				partitions: cycle.partitions,
				focuses: cycle.focuses,
			})),
		),
	);
}
