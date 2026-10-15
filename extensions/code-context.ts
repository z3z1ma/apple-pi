import { fileURLToPath } from "node:url";

export const CODE_CONTEXT_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { CONTEXT_LINT_TOOL_NAME, default } from "../components/code-context/src/index.js";
