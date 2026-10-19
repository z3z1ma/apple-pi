// The pack check for theme authors, from the repository's root:
//   node --import ./components/session-state/src/register.mjs apps/agent-world/src/check-theme.ts [<pack dir> ...]
// prints each problem as `<pack>/<file>: <fault>` and exits 1 when any pack has one. With no directory, it checks
// every pack in apps/agent-world/themes/.
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkThemePack, listThemes } from "./backend/theme-packs.js";
import { describeProblems } from "./theme-pack.js";

const themesDir = fileURLToPath(new URL("../themes/", import.meta.url));
const dirs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));

const packs = dirs.length
	? await Promise.all(dirs.map(async (dir) => ({ id: dir, problems: await checkThemePack(resolve(dir)) })))
	: (await listThemes(themesDir)).map(({ id, problems }) => ({ id: join("themes", id), problems }));

let failed = false;
for (const { id, problems } of packs) {
	if (!problems.length) {
		console.log(`${id}: the pack is good`);
		continue;
	}
	failed = true;
	for (const line of describeProblems(problems)) console.log(`${id}/${line}`);
}
if (!packs.length) {
	console.log("No theme packs found.");
	failed = true;
}
process.exit(failed ? 1 : 0);
