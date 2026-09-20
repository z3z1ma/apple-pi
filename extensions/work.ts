import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installWorkManager } from "../components/shared/src/work-manager.js";

export default function workExtension(pi: ExtensionAPI): void {
	installWorkManager(pi);
}
