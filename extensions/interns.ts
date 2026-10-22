import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installInterns } from "../components/interns/src/index.js";

export default function (pi: ExtensionAPI): void {
	installInterns(pi);
}
