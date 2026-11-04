import { fileURLToPath } from "node:url";

export const SYSTEM_PROMPT_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { default } from "../components/system-prompt/src/index.js";
