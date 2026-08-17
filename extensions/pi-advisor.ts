import { fileURLToPath } from "node:url";

export const ADVISOR_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { default } from "../components/advisor/src/index.js";
