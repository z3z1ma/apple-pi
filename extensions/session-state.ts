import { fileURLToPath } from "node:url";

export { default } from "../components/session-state/src/index.js";

/** Loaded by path in interactive child sessions, which do not discover package extensions. */
export const SESSION_STATE_EXTENSION_PATH = fileURLToPath(import.meta.url);
