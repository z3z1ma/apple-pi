import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installReviewPanel } from "../components/code-review/src/review-manager.js";
import { installReviewTools } from "../components/code-review/src/tools.js";

export default function codeReview(pi: ExtensionAPI): void {
	installReviewTools(pi);
	installReviewPanel(pi);
}
