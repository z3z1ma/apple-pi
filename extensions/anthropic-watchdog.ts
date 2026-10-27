import { fileURLToPath } from "node:url";

export const ANTHROPIC_WATCHDOG_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { default } from "../components/anthropic-watchdog/src/index.js";
