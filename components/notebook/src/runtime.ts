import { type Config, DEFAULTS, loadConfig } from "./config.js";

/** Root-owned deterministic notebook state. The pair programmer owns the model work. */
export class Runtime {
	config: Config = { ...DEFAULTS };
	configLoaded = false;
	configCwd: string | undefined;
	configProjectTrusted: boolean | undefined;
	disposed = false;
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
