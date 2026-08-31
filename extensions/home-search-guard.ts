import { fileURLToPath } from "node:url";

export const HOME_SEARCH_GUARD_EXTENSION_PATH = fileURLToPath(import.meta.url);
export { default } from "../components/home-search-guard/src/index.js";
