import { fileURLToPath } from "node:url";

export const TERSE_TOOLS_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { default } from "../components/terse-tools/src/index.js";
