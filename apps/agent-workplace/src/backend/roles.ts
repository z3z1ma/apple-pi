import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RoleChoice } from "../world.js";

const PACKAGE_ROLES = fileURLToPath(new URL("../../../../roles/", import.meta.url));

function frontMatter(text: string): Record<string, string> | undefined {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (!match) return undefined;
	const fields: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const colon = line.indexOf(":");
		if (colon > 0) fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
	}
	return fields;
}

export function loadRoleChoices(agentDir: string): RoleChoice[] {
	const roles = new Map<string, RoleChoice>();
	for (const dir of [PACKAGE_ROLES, join(agentDir, "roles")]) {
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir)
			.filter((name) => name.endsWith(".md"))
			.sort()) {
			let fields: Record<string, string> | undefined;
			try {
				fields = frontMatter(readFileSync(join(dir, file), "utf8"));
			} catch {
				continue;
			}
			if (!fields?.title || !fields.mandate) continue;
			roles.set(file.slice(0, -3), {
				name: file.slice(0, -3),
				title: fields.title,
				mandate: fields.mandate,
				manages: fields.manages === "true",
				writes: fields.writes === "true",
			});
		}
	}
	return [...roles.values()];
}
