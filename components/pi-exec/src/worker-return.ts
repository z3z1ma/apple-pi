import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PI_EXEC_RETURN_TOOL, structuredReturnTool } from "../../shared/src/structured-output.js";

export { PI_EXEC_RETURN_TOOL } from "../../shared/src/structured-output.js";
export const PI_EXEC_OUTPUT_SCHEMA_ENV = "PI_EXEC_OUTPUT_SCHEMA";

/** One-shot process adapter for the same structured return used in peer turns. */
export default function workerReturn(pi: ExtensionAPI): void {
	const schemaPath = process.env[PI_EXEC_OUTPUT_SCHEMA_ENV];
	if (!schemaPath) throw new Error(`${PI_EXEC_RETURN_TOOL} requires ${PI_EXEC_OUTPUT_SCHEMA_ENV}`);
	pi.registerTool(structuredReturnTool(JSON.parse(readFileSync(schemaPath, "utf8"))));
}
