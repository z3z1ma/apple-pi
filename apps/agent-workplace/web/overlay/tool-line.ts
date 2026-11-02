// How a tool's main argument reads on one line, wherever the interface shows one (side-panel rows, the examine card,
// the conversation panel's tool lines and "doing now"): without the `cd /abs/dir &&` agents put before most commands,
// and with paths inside the working directory (or the directory just changed to) relative to it.

/** A leading change of directory to an absolute (or home) path, joined to the command by `&&` or `;`. */
const LEADING_CD = /^cd\s+("[^"]*"|'[^']*'|[~/]\S*)\s*(?:&&|;)\s*/;

/** A main argument as a line shows it: no leading `cd <dir> &&`, and paths under the working directory relative. */
export function shortArg(arg: string | null, cwd: string | null | undefined): string | null {
	if (!arg) return arg;
	let shown = arg.trim();
	const dirs: string[] = [];
	const cd = LEADING_CD.exec(shown);
	if (cd) {
		dirs.push(cd[1].replace(/^["']|["']$/g, ""));
		shown = shown.slice(cd[0].length);
	}
	if (cwd) dirs.push(cwd);
	for (const dir of dirs) {
		const base = dir.replace(/\/+$/, "");
		if (!base || base === "~") continue;
		shown = shown.split(`${base}/`).join("");
		if (shown === base) shown = ".";
	}
	return shown || arg;
}
