import { containedProjectPath } from "../../ralph/src/path-boundary.js";
import type { ManagedAgentToolPolicy } from "../../subagents/src/service.js";

export function createReviewAuthorityPolicy(projectRoot: string, onDenied?: (reason: string) => void): ManagedAgentToolPolicy {
	return ({ toolName, args }) => {
		const object = args && typeof args === "object" ? args as Record<string, unknown> : {};
		for (const key of ["path", "root", "cwd"]) {
			const value = object[key];
			if (typeof value === "string" && containedProjectPath(projectRoot, value) === undefined) {
				const reason = `${toolName}.${key} escapes the trusted review project or targets .git`;
				onDenied?.(reason);
				return { block: true, reason, terminate: true };
			}
		}
		return undefined;
	};
}
