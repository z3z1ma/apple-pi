import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installTerseToolRenderer } from "./patch.js";

export default function (_pi?: ExtensionAPI): void {
	installTerseToolRenderer();
}
