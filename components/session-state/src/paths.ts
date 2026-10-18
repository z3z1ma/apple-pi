import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface StatePaths {
	dir: string;
	db: string;
	socket: string;
	/** An SQLite file the runtime holds an exclusive lock on for its whole life; the OS frees it on exit. */
	lock: string;
	/** The running runtime's pid, written after it takes the lock. */
	pid: string;
	/** The runtime's stdout and stderr. */
	log: string;
}

/** Pi's own rule for `PI_CODING_AGENT_DIR`: a leading `~` means the home directory. */
function agentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR;
	if (!configured) return join(homedir(), ".pi", "agent");
	if (configured === "~") return homedir();
	if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
	return resolve(configured);
}

/** Where the runtime keeps its files; read at call time so tests can redirect it. */
export function statePaths(): StatePaths {
	const dir = join(agentDir(), "state");
	return {
		dir,
		db: join(dir, "apple-pi.db"),
		socket: join(dir, "apple-pi.sock"),
		lock: join(dir, "apple-pi-runtime.lock"),
		pid: join(dir, "apple-pi-runtime.pid"),
		log: join(dir, "apple-pi-runtime.log"),
	};
}
