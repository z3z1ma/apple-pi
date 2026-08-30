import { type Config, DEFAULTS, loadConfig } from "./config.js";

const STALE_EXTENSION_CTX_MESSAGE = "This extension ctx is stale after session replacement or reload";

export function isStaleExtensionCtxError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes(STALE_EXTENSION_CTX_MESSAGE);
}

/** Root-owned deterministic notebook state. Pair Programmer owns the model work. */
export class Runtime {
	config: Config = { ...DEFAULTS };
	configLoaded = false;
	configCwd: string | undefined;
	configProjectTrusted: boolean | undefined;
	disposed = false;
	compactInFlight = false;
	notebookEmptyBackoff:
		| {
				sessionIdentity: string | undefined;
				coverageId: string | undefined;
				tokensAtEmpty: number;
		  }
		| undefined;

	ensureConfig(cwd: string, projectTrusted = false): Config {
		if (this.configLoaded && this.configCwd === cwd && this.configProjectTrusted === projectTrusted) return this.config;
		this.config = loadConfig(cwd, projectTrusted);
		this.configCwd = cwd;
		this.configProjectTrusted = projectTrusted;
		this.configLoaded = true;
		return this.config;
	}

	dispose(): void {
		this.disposed = true;
	}
}
