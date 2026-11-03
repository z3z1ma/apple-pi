import "../../../../components/session-state/src/register.mjs";
import { app } from "electron";

try {
	await import("../../dist/electron/main.js");
	process.stderr.write("agent-workplace: loaded\n");
} catch (error) {
	process.stderr.write(`agent-workplace: failed to load: ${error?.stack ?? error}\n`);
	app.exit(1);
}
