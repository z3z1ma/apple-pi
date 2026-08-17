import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerPiVccCommand } from "../components/vcc/src/commands/pi-vcc.js";
import { registerVccRecallCommand } from "../components/vcc/src/commands/vcc-recall.js";
import { registerInvisibleContinue } from "../components/vcc/src/core/invisible-continue.js";
import { scaffoldSettings } from "../components/vcc/src/core/settings.js";
import { registerBeforeCompactHook, type VccCompactionAugmenter } from "../components/vcc/src/hooks/before-compact.js";
import { registerProactiveThresholdHook } from "../components/vcc/src/hooks/proactive-threshold.js";
import { registerRecallTool as registerVccRecallTool } from "../components/vcc/src/tools/recall.js";

export const VCC_EXTENSION_PATH = fileURLToPath(import.meta.url);

/** VCC only. The root context extension passes a memory augmenter; children and workers do not. */
export function installVcc(pi: ExtensionAPI, augmentCompaction?: VccCompactionAugmenter): void {
	scaffoldSettings();
	registerInvisibleContinue(pi);
	const getLastCompactionStats = registerBeforeCompactHook(pi, augmentCompaction);
	registerProactiveThresholdHook(pi);
	registerPiVccCommand(pi, getLastCompactionStats);
	registerVccRecallCommand(pi);
	registerVccRecallTool(pi);
}

export default function vcc(pi: ExtensionAPI): void {
	installVcc(pi);
}
