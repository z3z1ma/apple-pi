import { fileURLToPath } from "node:url";

export const STATUS_FOOTER_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { default } from "../components/status-footer/src/index.js";
