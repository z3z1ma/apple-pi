import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { applyXaiHostedTools } from "./payload.js";

export { applyXaiHostedTools } from "./payload.js";

export default function installXaiHostedTools(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => applyXaiHostedTools(event.payload, ctx.model));
}
