import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installReviewTools } from "../components/code-review/src/tools.js";

export default function codeReview(pi: ExtensionAPI): void {
	installReviewTools(pi);
}
