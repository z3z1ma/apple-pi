// The runtime daemon's entrypoint. A bridge starts it detached with Node's type stripping and register.mjs;
// stdout and stderr go to the runtime log. Exit 0 means another runtime already runs; any other code is a failure.
import { statePaths } from "./paths.js";
import { Runtime } from "./runtime.js";

const runtime = new Runtime(statePaths());
try {
	if (!(await runtime.start())) process.exit(0);
} catch (error) {
	console.error(`session state runtime failed to start: ${(error as Error).stack ?? error}`);
	process.exit(1);
}
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
	process.on(signal, () => {
		runtime.stop();
		process.exit(0);
	});
