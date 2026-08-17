import { readFileSync } from "node:fs";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PI_EXEC_RETURN_TOOL = "pi_exec_return";
export const PI_EXEC_OUTPUT_SCHEMA_ENV = "PI_EXEC_OUTPUT_SCHEMA";

/** Worker-only structured return. Loaded with `pi -e` under `--no-extensions`. */
export default function runtimeWorkerReturn(pi: ExtensionAPI): void {
	const schemaPath = process.env[PI_EXEC_OUTPUT_SCHEMA_ENV];
	if (!schemaPath) {
		throw new Error(`${PI_EXEC_RETURN_TOOL} requires ${PI_EXEC_OUTPUT_SCHEMA_ENV}`);
	}
	const parameters = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
	pi.registerTool(
		defineTool({
			name: PI_EXEC_RETURN_TOOL,
			label: "Return",
			description:
				"Submit the final structured result. You MUST use this as your last action. Do not put the result in assistant text.",
			promptSnippet: "Return the final structured result and end the turn",
			promptGuidelines: [
				`You must finish by calling ${PI_EXEC_RETURN_TOOL} with arguments that match its parameter schema.`,
				"That call is this worker's return value. After calling it, do not emit another assistant response.",
			],
			parameters: parameters as never,
			constrainedSampling: { type: "json_schema", strict: "prefer" },
			async execute(_toolCallId, params) {
				return {
					content: [{ type: "text", text: "Result returned." }],
					details: params,
					terminate: true,
				};
			},
		}),
	);
}
