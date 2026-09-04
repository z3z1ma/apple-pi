import { fileURLToPath } from "node:url";

export const VROOM_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { default } from "../components/vroom/src/index.js";
