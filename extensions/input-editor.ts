import { fileURLToPath } from "node:url";

export const INPUT_EDITOR_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { default } from "../components/input-editor/src/index.js";
