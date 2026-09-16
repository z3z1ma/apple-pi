import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * Kill a process and all its children across platforms.
 * On Unix, kills the process group with SIGKILL.
 * On Windows, invokes taskkill.exe /F /T /PID.
 */
export function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		try {
			const child = spawn(
				join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
				["/F", "/T", "/PID", String(pid)],
				{
					stdio: "ignore",
					detached: true,
					windowsHide: true,
				},
			);
			child.once("error", () => {});
		} catch {
			// Process may already be terminated.
		}
	} else {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Process already dead.
			}
		}
	}
}
