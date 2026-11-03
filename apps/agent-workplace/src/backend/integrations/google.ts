import { execFile } from "node:child_process";
import type { CliStatus } from "../../integrations.js";

export function googleStatus(env?: NodeJS.ProcessEnv): Promise<CliStatus> {
	return new Promise((resolve) => {
		execFile("gws", ["auth", "status"], { env: env ?? process.env, timeout: 30_000 }, (error, stdout) => {
			if (error) {
				resolve({
					ok: false,
					reason:
						(error as NodeJS.ErrnoException).code === "ENOENT"
							? "The Google Workspace CLI (gws) is not installed."
							: "Google sign-in could not be checked. Run gws auth status in a terminal.",
				});
				return;
			}
			try {
				const status = JSON.parse(stdout) as { user?: unknown; auth_method?: unknown };
				resolve({
					ok: true,
					account: status.auth_method !== "none" && typeof status.user === "string" ? status.user.trim() || null : null,
				});
			} catch {
				resolve({ ok: false, reason: "gws did not return a valid sign-in status." });
			}
		});
	});
}
