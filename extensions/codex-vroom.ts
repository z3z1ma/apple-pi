import { fileURLToPath } from "node:url";

export const CODEX_FAST_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { default } from "../components/codex-vroom/src/index.js";
