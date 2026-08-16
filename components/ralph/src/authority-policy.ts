import { containedProjectPath } from "./path-boundary.js";
import type { ManagedAgentToolPolicy, ManagedAgentToolPolicyResult } from "../../subagents/src/service.js";

export interface AuthorityDenial {
	toolName: string;
	reason: string;
}

function deny(reason: string): ManagedAgentToolPolicyResult {
	return { block: true, reason, terminate: true };
}

function classifyBash(command: string): string | undefined {
	if (/\$\(|`/.test(command)) return "Shell command substitution is outside Ralph's inspectable authority boundary";
	if (/[\r\n;&|]/.test(command)) return "Ralph Bash calls must contain one command; invoke validation commands separately";
	if (/(?:^|\s)["']?(?:\/|~\/|\.\.?(?:\/|\s|$))/.test(command) || /\$(?:[A-Za-z_]\w*|\{)/.test(command)) return "Shell paths and variables may not escape the project boundary";
	if (/\.ledger(?:\/|\b)/.test(command)) return "Shell access to ledger authority is not allowed; use read and the structured executor report";
	const normalized = command
		.replace(/(^|\s)(["'])\/(?:[A-Za-z0-9._-]+\/)*([A-Za-z0-9._-]+)\2/g, "$1$3")
		.replace(/(^|\s)\/(?:[A-Za-z0-9._-]+\/)*([A-Za-z0-9._-]+)/g, "$1$2");
	if (/(?:^|\s)(?:curl|wget|ssh|scp|sftp|rsync|gh|aws|gcloud|az|doctl|flyctl|heroku)(?:\s|$)/i.test(normalized)) {
		return "Network and remote-service commands require explicit human execution";
	}
	if (/(?:^|\s)(?:kubectl|helm)(?:\s+(?:apply|create|delete|edit|patch|replace|rollout|scale|set)|\s*$)/i.test(normalized)) {
		return "Cluster mutation requires explicit human execution";
	}
	if (/(?:^|\s)terraform\s+(?:apply|destroy|import|taint|untaint|state\s+(?:mv|rm|push))(?:\s|$)/i.test(normalized)) {
		return "Infrastructure mutation requires explicit human execution";
	}
	if (/(?:^|\s)(?:npm|pnpm|yarn|bun)\s+(?:publish|deploy|install|add|link)(?:\s|$)/i.test(normalized) || /(?:^|\s)npx(?!\s+--no-install\b)/i.test(normalized)) {
		return "Publishing and deployment require explicit human execution";
	}
	if (/(?:^|\s)(?:rm|rmdir|shred|ln|mv|cp|install|mkdir|touch|truncate|tee|dd|chmod|chown)\b/i.test(normalized) || /(?:^|\s)find\b.*(?:-delete|-exec\b)/i.test(normalized)) return "Direct filesystem mutation requires explicit human execution or the edit/write tools";
	if (/(?:^|\s)(?:python\d*|node|ruby|perl|sh|bash|zsh|fish)\s+(?:-c|-e)\b/i.test(normalized) || /(?:^|\s)(?:eval|xargs|busybox|env|printenv)\b/i.test(normalized)) return "Inline, indirect, or environment-dumping programs are outside Ralph's inspectable command boundary";
	const gitCommands = [...normalized.matchAll(/(?:^|[;&|]\s*|\s)git\s+([a-z-]+)/gi)].map((match) => match[1].toLowerCase());
	const readOnlyGit = new Set(["status", "diff", "log", "show", "grep", "ls-files", "rev-parse", "branch", "blame", "describe"]);
	if (gitCommands.some((subcommand) => !readOnlyGit.has(subcommand))) {
		return "Git mutation is owned by the human/orchestrator; Ralph agents may inspect Git only";
	}
	for (const match of normalized.matchAll(/(?:^|[;&|]\s*|\s)git\s+branch\b([^;&|]*)/gi)) {
		const args = match[1].trim();
		if (args && !/^(?:--show-current|--list|-l|--contains\b|--no-contains\b)/.test(args)) {
			return "Git branch mutation is owned by the human/orchestrator";
		}
	}
	if (/[<>]/.test(normalized)) {
		return "Shell redirection is not an auditable Ralph write; use edit or write inside the project";
	}
	if (/(?:^|\s)(?:cd|pushd)\s+(?:\.\.|\/|~)/.test(normalized)) return "Shell traversal outside the project is not allowed";
	return undefined;
}

export function createExecutorAuthorityPolicy(
	projectRoot: string,
	onDenial: (denial: AuthorityDenial) => void,
	ledgerRoot = projectRoot,
): ManagedAgentToolPolicy {
	return ({ toolName, args }) => {
		const object = args && typeof args === "object" ? args as Record<string, unknown> : {};
		for (const key of ["path", "root", "cwd"]) {
			const value = object[key];
			if (typeof value !== "string") continue;
			const projectRelative = containedProjectPath(projectRoot, value);
			const ledgerRelative = containedProjectPath(ledgerRoot, value);
			const targetsLedger = ledgerRelative === ".ledger" || ledgerRelative?.startsWith(".ledger/");
			const readOnlyLedgerAccess = key !== "cwd" && ["read", "grep", "find", "ls"].includes(toolName) && targetsLedger;
			if (toolName === "bash" && key === "cwd" && targetsLedger) {
				const reason = "Shell execution inside .ledger could mutate controller-owned task authority";
				onDenial({ toolName, reason });
				return deny(reason);
			}
			if ((toolName === "edit" || toolName === "write") && ((projectRelative === ".ledger" || projectRelative?.startsWith(".ledger/")) || targetsLedger)) {
				const reason = "Only the Ralph controller may mutate .ledger task authority";
				onDenial({ toolName, reason });
				return deny(reason);
			}
			if (projectRelative === undefined && !readOnlyLedgerAccess) {
				const reason = `${toolName}.${key} escapes the implementation workspace and read-only ledger, traverses a symlink, or targets .git`;
				onDenial({ toolName, reason });
				return deny(reason);
			}
		}
		if (toolName !== "bash") return undefined;
		const command = typeof object.command === "string" ? object.command : "";
		const reason = classifyBash(command);
		if (!reason) return undefined;
		onDenial({ toolName, reason });
		return deny(reason);
	};
}

export function explainBashDenial(command: string): string | undefined {
	return classifyBash(command);
}
