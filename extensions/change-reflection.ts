import { fileURLToPath } from "node:url";

export const CHANGE_REFLECTION_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { default } from "../components/change-reflection/src/index.js";
