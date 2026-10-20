// Links in transcripts open through the main process; the window itself never navigates. Web links (http and https)
// open in the operator's browser, and links to files on disk in his default app for them. A transcript is untrusted
// text, so a `javascript:` or custom-scheme link opens nothing, and a file that could run is shown in Finder instead.
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * Kinds of file that macOS runs, installs, or scripts when opened. A link to one, like any file with an execute bit, is
 * shown in Finder instead of opened: a transcript is untrusted, and a click must not run a program.
 */
const LAUNCHES =
	/\.(app|command|tool|terminal|pkg|mpkg|workflow|action|scpt|scptd|applescript|jar|sh|bash|zsh|py|rb|pl)$/i;

/**
 * The file a transcript's link names, as an absolute path on disk: a `file:` URL, an absolute or `~` path, or a path
 * relative to `base` (the agent's directory). A `:12`, `:12:3`, or `#L12` line suffix is dropped when the path with it
 * does not exist. Undefined for a web link, another scheme, or a file that does not exist.
 */
export function fileLink(href: unknown, base: unknown): string | undefined {
	if (typeof href !== "string" || !href.trim() || href.length > LINK_MAX) return undefined;
	let path = href.trim();
	if (/^file:/i.test(path)) {
		try {
			path = fileURLToPath(path);
		} catch {
			return undefined;
		}
	} else if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(path)) return undefined;
	else {
		try {
			path = decodeURIComponent(path);
		} catch {}
		if (path === "~" || path.startsWith("~/")) path = join(homedir(), path.slice(1));
		else if (!isAbsolute(path)) {
			if (typeof base !== "string" || !isAbsolute(base)) return undefined;
			path = resolve(base, path);
		}
	}
	for (const candidate of [path, path.replace(/(:\d+){1,2}$|#L\d+(-L?\d+)?$/, "")])
		if (existsSync(candidate)) return candidate;
	return undefined;
}

/**
 * Open a file a transcript links to with the operator's default app for it (`open`, Electron's `shell.openPath`, which
 * resolves with an error message or ""), or show it in Finder (`reveal`) when opening could run something.
 */
export async function openFileLink(
	href: unknown,
	base: unknown,
	open: (path: string) => Promise<string>,
	reveal: (path: string) => void,
): Promise<CommandResult> {
	const path = fileLink(href, base);
	if (!path) return { ok: false, reason: `No file at ${typeof href === "string" ? href : "that link"}.` };
	let launches = LAUNCHES.test(path);
	try {
		const stat = statSync(path);
		if (stat.isFile() && stat.mode & 0o111) launches = true;
	} catch (error) {
		return { ok: false, reason: `The file could not be read: ${(error as Error).message}` };
	}
	if (launches) {
		reveal(path);
		return { ok: true };
	}
	const failure = await open(path);
	return failure ? { ok: false, reason: `The file did not open: ${failure}` } : { ok: true };
}
