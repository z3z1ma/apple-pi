import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function providerFailoverEnabled(agentDir = getAgentDir()): boolean {
	const path = join(agentDir, "settings.json");
	let content: string;
	try {
		content = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
	let settings: unknown;
	try {
		settings = JSON.parse(content.replace(/^\uFEFF/, ""));
	} catch {
		throw new Error(`Invalid provider failover settings at ${path}: expected a JSON object.`);
	}
	if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
		throw new Error(`Invalid provider failover settings at ${path}: expected a JSON object.`);
	}
	if (!("providerFailover" in settings)) return false;
	if (typeof settings.providerFailover !== "boolean") {
		throw new Error(`Invalid providerFailover setting at ${path}: expected a boolean.`);
	}
	return settings.providerFailover;
}
