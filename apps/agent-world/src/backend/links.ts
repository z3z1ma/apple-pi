// Links in transcripts open in the operator's own browser, through the main process; the window itself never
// navigates. Only web links (http and https) open: a transcript is untrusted text, and a `file:`, `javascript:`, or
// custom-scheme link from a tool's output must not run anything on the operator's machine.
import type { CommandResult } from "../world.js";

/** The longest link Agent World hands to the browser. */
const LINK_MAX = 8192;

/** The link as a full http or https URL, or undefined for anything else. */
export function webLink(url: unknown): string | undefined {
	if (typeof url !== "string" || !url || url.length > LINK_MAX) return undefined;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
}

/** Open a web link with `open` (Electron's `shell.openExternal`); anything but http and https is refused unopened. */
export async function openLink(url: unknown, open: (href: string) => Promise<void>): Promise<CommandResult> {
	const href = webLink(url);
	if (!href) return { ok: false, reason: "Only web links (http and https) open from Agent World." };
	try {
		await open(href);
		return { ok: true };
	} catch (error) {
		return { ok: false, reason: `The browser did not open the link: ${String((error as Error)?.message ?? error)}` };
	}
}
