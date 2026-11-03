import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface StatePaths {
	dir: string;
	db: string;
	socket: string;
	lock: string;
	pid: string;
	log: string;
	transcriptIndex: string;
}

export function agentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR;
	if (!configured) return join(homedir(), ".pi", "agent");
	if (configured === "~") return homedir();
	if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
	return resolve(configured);
}

export function statePaths(): StatePaths {
	const dir = join(agentDir(), "state");
	return {
		dir,
		db: join(dir, "apple-pi.db"),
		socket: join(dir, "apple-pi.sock"),
		lock: join(dir, "apple-pi-runtime.lock"),
		pid: join(dir, "apple-pi-runtime.pid"),
		log: join(dir, "apple-pi-runtime.log"),
		transcriptIndex: join(dir, "transcript-index.db"),
	};
}
