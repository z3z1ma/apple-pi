import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadAllMessages } from "../core/load-messages.js";
import { getFileIndicators, getTouchedFiles, searchEntries } from "../core/search-entries.js";
import { formatRecallOutput, formatTouchedOutput } from "../core/format-recall.js";
import { getActiveLineageEntryIds } from "../core/lineage.js";
import { normalizeRecallMode, parseRecallScope } from "../core/recall-scope.js";
import { expandEntryFile, parseDrillDown } from "../core/drill-down.js";

const PAGE_SIZE = 5;
const DEFAULT_RECENT = 25;

export const registerVccRecallCommand = (pi: ExtensionAPI) => {
	pi.registerCommand("pi-vcc-recall", {
		description: "Search history; use mode:touched for files or #N:path to recover a write/edit payload.",
		handler: async (args: string, ctx) => {
			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) {
				ctx.ui.notify("No session file available.", "error");
				return;
			}

			const raw = args.trim();
			const parsed = parseRecallScope(raw);
			const lineageEntryIds = parsed.scope === "lineage" ? getActiveLineageEntryIds(ctx.sessionManager) : undefined;
			const pageMatch = parsed.text.match(/\bpage:(\d+)\b/i);
			const page = pageMatch ? Math.max(1, parseInt(pageMatch[1], 10)) : 1;
			const modeMatch = parsed.text.match(/\bmode:(history|file|touched)\b/i);
			const mode = normalizeRecallMode(modeMatch?.[1]?.toLowerCase());
			const query = parsed.text
				.replace(/\bpage:\d+\b/i, "")
				.replace(/\bmode:(?:history|file|touched)\b/i, "")
				.trim();
			const { rendered, rawMessages } = loadAllMessages(sessionFile, false, lineageEntryIds);

			if (mode === "touched") {
				const output = formatTouchedOutput(getTouchedFiles(rawMessages, rendered), page);
				pi.sendMessage({ customType: "vcc-recall", content: output, display: true }, { triggerTurn: true });
				return;
			}

			const drillDown = query ? parseDrillDown(query) : undefined;
			if (drillDown) {
				const output = expandEntryFile(rendered, rawMessages, drillDown);
				pi.sendMessage({ customType: "vcc-recall", content: output, display: true }, { triggerTurn: true });
				return;
			}

			if (!query) {
				const start = Math.max(0, rendered.length - DEFAULT_RECENT);
				const recent = rendered.slice(start).map((entry, offset) => {
					const fileMatches = getFileIndicators(rawMessages[start + offset]!);
					return fileMatches.length > 0 ? { ...entry, fileMatches } : entry;
				});
				const output = (parsed.scope === "all" ? "Scope: all\n\n" : "") + formatRecallOutput(recent);
				pi.sendMessage({ customType: "vcc-recall", content: output, display: true }, { triggerTurn: true });
				return;
			}

			const allResults = searchEntries(rendered, rawMessages, query, mode);

			const start = (page - 1) * PAGE_SIZE;
			const pageResults = allResults.slice(start, start + PAGE_SIZE);
			const totalPages = Math.ceil(allResults.length / PAGE_SIZE);
			const scopeSuffix = parsed.scope === "all" ? " (scope: all)" : "";
			const header =
				totalPages > 1
					? `Page ${page}/${totalPages} (${allResults.length} total matches${scopeSuffix})`
					: `${allResults.length} matches${scopeSuffix}`;
			const footer =
				page < totalPages
					? `\n--- /pi-vcc-recall ${query}${parsed.scope === "all" ? " scope:all" : ""} page:${page + 1} ---`
					: "";
			const output = formatRecallOutput(pageResults, query, header) + footer;
			pi.sendMessage({ customType: "vcc-recall", content: output, display: true }, { triggerTurn: true });
		},
	});
};
