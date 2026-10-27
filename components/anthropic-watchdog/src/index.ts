import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { acquireWatchdog } from "./watchdog.js";

export default function install(pi: ExtensionAPI): void {
	let release: (() => void) | undefined;
	pi.on("session_start", () => {
		release?.();
		release = acquireWatchdog();
	});
	pi.on("session_shutdown", () => {
		release?.();
		release = undefined;
	});
}
