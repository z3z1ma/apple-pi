export interface AcceptanceCriterionDocument {
	id: string;
	text: string;
}

export type WorkItemState = "open" | "complete" | "cancelled";

export interface WorkItem {
	id: string;
	state: WorkItemState;
	description: string;
	cancellationReason?: string;
}

export type WorkItemIssueCode =
	| "duplicate_work_item"
	| "malformed_work_item"
	| "misplaced_work_item"
	| "misplaced_work_items_section"
	| "non_substantive_cancellation"
	| "non_substantive_work_item";

export interface WorkItemIssue {
	code: WorkItemIssueCode;
	line: number;
	message: string;
}

export interface TaskSectionRange {
	headingStart: number;
	bodyStart: number;
	bodyEnd: number;
}

export interface TaskDocument {
	headers: Record<string, string>;
	title?: string;
	sections: Map<string, string>;
	sectionRanges: Map<string, TaskSectionRange>;
	criteria: AcceptanceCriterionDocument[];
	workItems: WorkItem[];
	workItemIssues: WorkItemIssue[];
}

interface Section extends TaskSectionRange {
	heading: string;
	body: string;
	rawBody: string;
	line: number;
	bodyStartLine: number;
}

function lineNumber(content: string, offset: number): number {
	return content.slice(0, offset).split(/\r?\n/).length;
}

function parseHeaders(content: string): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const line of content.split(/\r?\n/)) {
		if (/^#\s/.test(line)) break;
		const match = /^([A-Za-z][A-Za-z -]*):\s*(.*?)\s*$/.exec(line);
		if (!match) continue;
		const key = match[1].toLowerCase();
		if (headers[key] !== undefined) throw new Error(`Duplicate record header: ${match[1]}`);
		headers[key] = match[2];
	}
	return headers;
}

function parseSections(content: string): Section[] {
	const sections: Section[] = [];
	const matches = [...content.matchAll(/^##\s+(.+?)\s*$/gm)];
	const names = new Set<string>();
	for (let index = 0; index < matches.length; index++) {
		const match = matches[index];
		const heading = match[1].trim().toLowerCase();
		if (names.has(heading)) throw new Error(`Duplicate record section: ${match[1].trim()}`);
		names.add(heading);
		const start = (match.index ?? 0) + match[0].length;
		const end = matches[index + 1]?.index ?? content.length;
		const rawBody = content.slice(start, end);
		sections.push({
			heading,
			headingStart: match.index ?? 0,
			bodyStart: start,
			bodyEnd: end,
			body: rawBody.trim(),
			rawBody,
			line: lineNumber(content, match.index ?? 0),
			bodyStartLine: lineNumber(content, start),
		});
	}
	return sections;
}

function parseCriteria(section: string): AcceptanceCriterionDocument[] {
	const criteria: AcceptanceCriterionDocument[] = [];
	const ids = new Set<string>();
	for (const line of section.split(/\r?\n/)) {
		const match = /^\s*(?:[-*]\s*)?(AC-\d{3,})\s*:\s*(.+?)\s*$/.exec(line);
		if (!match) continue;
		if (ids.has(match[1])) throw new Error(`Duplicate acceptance criterion: ${match[1]}`);
		ids.add(match[1]);
		criteria.push({ id: match[1], text: match[2] });
	}
	return criteria;
}

function substantive(value: string): boolean {
	const normalized = value.trim();
	return (
		normalized.length >= 12 &&
		!/^(?:none|n\/a|todo|pending|tbd|not yet|will be|do it)(?:\b|[.:])/i.test(normalized) &&
		!/^no\.?$/i.test(normalized)
	);
}

function looksLikeWorkItem(line: string): boolean {
	return /^\s*[-*]\s+\[[^\]]*\]\s+\bwi-[a-z0-9-]+\b/i.test(line);
}

function parseWorkItems(section: Section, issues: WorkItemIssue[]): WorkItem[] {
	const items: WorkItem[] = [];
	const ids = new Set<string>();
	for (const [index, line] of section.rawBody.split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		const lineNumberValue = section.bodyStartLine + index;
		const match = /^\s*-\s+\[( |x|-)\]\s+(WI-\d{3})\s*:\s*(.+?)\s*$/.exec(line);
		if (!match) {
			issues.push({
				code: "malformed_work_item",
				line: lineNumberValue,
				message:
					"Work Items may contain only canonical checkbox rows with a WI-### identifier, colon, and substantive description.",
			});
			continue;
		}
		const [, marker, id, rawDescription] = match;
		const state: WorkItemState = marker === " " ? "open" : marker === "x" ? "complete" : "cancelled";
		let description = rawDescription.trim();
		let cancellationReason: string | undefined;
		if (state === "cancelled") {
			const cancellation = /^(.*?)\s+—\s+Cancelled:\s*(.+?)\s*$/.exec(description);
			if (!cancellation) {
				issues.push({
					code: "malformed_work_item",
					line: lineNumberValue,
					message: `${id} is cancelled but omits a Cancelled: reason.`,
				});
			} else {
				description = cancellation[1].trim();
				cancellationReason = cancellation[2].trim();
				if (!substantive(cancellationReason))
					issues.push({
						code: "non_substantive_cancellation",
						line: lineNumberValue,
						message: `${id} cancellation reason is not substantive.`,
					});
			}
		}
		if (!substantive(description))
			issues.push({
				code: "non_substantive_work_item",
				line: lineNumberValue,
				message: `${id} description is not substantive.`,
			});
		if (ids.has(id))
			issues.push({ code: "duplicate_work_item", line: lineNumberValue, message: `Duplicate work item: ${id}` });
		ids.add(id);
		items.push({ id, state, description, ...(cancellationReason && { cancellationReason }) });
	}
	return items;
}

export function parseTaskDocument(content: string): TaskDocument {
	const headers = parseHeaders(content);
	const title = /^#\s+(.+?)\s*$/m.exec(content)?.[1]?.trim();
	const sections = parseSections(content);
	const sectionMap = new Map(sections.map((section) => [section.heading, section.body]));
	const sectionRanges = new Map(
		sections.map((section) => [
			section.heading,
			{
				headingStart: section.headingStart,
				bodyStart: section.bodyStart,
				bodyEnd: section.bodyEnd,
			},
		]),
	);
	const issues: WorkItemIssue[] = [];
	const workItemsSection = sections.find((section) => section.heading === "work items");
	if (workItemsSection) {
		const acceptanceIndex = sections.findIndex((section) => section.heading === "acceptance criteria");
		const workItemsIndex = sections.indexOf(workItemsSection);
		const referencesIndex = sections.findIndex((section) => section.heading === "references");
		if (
			acceptanceIndex === -1 ||
			referencesIndex === -1 ||
			workItemsIndex <= acceptanceIndex ||
			workItemsIndex >= referencesIndex
		) {
			issues.push({
				code: "misplaced_work_items_section",
				line: workItemsSection.line,
				message: "Work Items must appear between Acceptance Criteria and References.",
			});
		}
	}
	const workItemsSectionIndex = workItemsSection ? sections.indexOf(workItemsSection) : -1;
	const workItemsStartLine = workItemsSection?.line ?? -1;
	const workItemsEndLine =
		workItemsSectionIndex === -1 ? -1 : (sections[workItemsSectionIndex + 1]?.line ?? Number.MAX_SAFE_INTEGER) - 1;
	for (const [index, line] of content.split(/\r?\n/).entries()) {
		const lineNumberValue = index + 1;
		if (looksLikeWorkItem(line) && (lineNumberValue <= workItemsStartLine || lineNumberValue > workItemsEndLine)) {
			issues.push({
				code: "misplaced_work_item",
				line: lineNumberValue,
				message: "Work items must appear in the Work Items section.",
			});
		}
	}
	return {
		headers,
		title,
		sections: sectionMap,
		sectionRanges,
		criteria: parseCriteria(sectionMap.get("acceptance criteria") ?? ""),
		workItems: workItemsSection ? parseWorkItems(workItemsSection, issues) : [],
		workItemIssues: issues,
	};
}
