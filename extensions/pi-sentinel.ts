import { fileURLToPath } from "node:url";

export const SENTINEL_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { default } from "../components/sentinel/src/index.js";
