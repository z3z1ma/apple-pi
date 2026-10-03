import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerServerCompactionHooks } from "./hooks.js";

export {
	activeTools,
	compactOnServer,
	findLatestServerCompaction,
	registerServerCompactionHooks,
	registerServerCompactionReplayHooks,
	type ServerCompactionResult,
} from "./hooks.js";
export { serverCompactionMethod } from "./target.js";
export type { ServerCompaction, ServerCompactionDetails } from "./types.js";

export default function installServerCompaction(pi: ExtensionAPI): void {
	registerServerCompactionHooks(pi);
}
