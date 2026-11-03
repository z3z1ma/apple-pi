const LEADING_CD = /^cd\s+("[^"]*"|'[^']*'|[~/]\S*)\s*(?:&&|;)\s*/;

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
