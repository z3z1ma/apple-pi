import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, loadSkills, stripFrontmatter } from "@earendil-works/pi-coding-agent";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface SkillListItem {
	name: string;
	description: string;
}

export interface SkillCatalogOptions {
	cwd: string;
	agentDir?: string;
	skillPaths?: string[];
	includeDefaults?: boolean;
}

/** Packaged `package.json#pi.skills` directories, resolved from this package root. */
export function packagedSkillPaths(): string[] {
	try {
		const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
			pi?: { skills?: unknown };
		};
		const listed = manifest.pi?.skills;
		if (!Array.isArray(listed)) return [join(PACKAGE_ROOT, "skills")];
		const paths = listed
			.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
			.map((entry) => resolve(PACKAGE_ROOT, entry));
		return paths.length > 0 ? paths : [join(PACKAGE_ROOT, "skills")];
	} catch {
		return [join(PACKAGE_ROOT, "skills")];
	}
}

function catalog(options: SkillCatalogOptions) {
	return loadSkills({
		cwd: options.cwd,
		agentDir: options.agentDir ?? getAgentDir(),
		skillPaths: options.skillPaths ?? packagedSkillPaths(),
		includeDefaults: options.includeDefaults ?? true,
	}).skills;
}

export function listSkills(options: SkillCatalogOptions): SkillListItem[] {
	return catalog(options)
		.map((skill) => ({ name: skill.name, description: skill.description }))
		.sort((left, right) => left.name.localeCompare(right.name));
}

export function readSkillBody(name: string, options: SkillCatalogOptions): string {
	const trimmed = typeof name === "string" ? name.trim() : "";
	if (!trimmed) throw new Error("skills.body requires a skill name");
	const skill = catalog(options).find((entry) => entry.name === trimmed);
	if (!skill) throw new Error(`Unknown skill: ${trimmed}`);
	return stripFrontmatter(readFileSync(skill.filePath, "utf8")).trim();
}
