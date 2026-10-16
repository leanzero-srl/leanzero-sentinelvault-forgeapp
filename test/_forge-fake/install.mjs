// Import FIRST (before any dynamic import of src/server): registers the resolution hook that
// replaces the Forge runtime packages with the in-memory fakes.
import { register } from "node:module";

register("./loader.mjs", import.meta.url);
