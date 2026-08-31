import { fileURLToPath } from "node:url";

export const WIKI_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { WIKI_TOOL_NAMES, default } from "../components/wiki/src/index.js";
