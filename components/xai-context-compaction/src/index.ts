import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerXaiCompactionHooks } from "./hooks.js";

export { convertMessagesForXaiCompaction, isXaiResponsesModel } from "./convert.js";
export {
	compactWithXai,
	findLatestXaiCompaction,
	registerXaiCompactionHooks,
	registerXaiCompactionReplayHooks,
} from "./hooks.js";
export { injectXaiCompaction, payloadHasXaiCompaction } from "./inject.js";
export type { XaiCompactionDetails, XaiCompactionItem } from "./types.js";

export default function installXaiContextCompaction(pi: ExtensionAPI): void {
	registerXaiCompactionHooks(pi);
}
