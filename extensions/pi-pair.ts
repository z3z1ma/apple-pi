import { fileURLToPath } from "node:url";

export const PAIR_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { default } from "../components/pair-programmer/src/index.js";
