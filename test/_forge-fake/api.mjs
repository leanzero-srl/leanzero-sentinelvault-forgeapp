// Fake @forge/api: asApp()/asUser() route every Confluence request through the scenario's route
// table (state.mjs). `route` encodes interpolations the way the real tag does.
import { dispatchConfluence, respond } from "./state.mjs";

export const route = (strings, ...vals) => strings.reduce((acc, s, i) => acc + s + (i < vals.length ? encodeURIComponent(String(vals[i])) : ""), "");
export const assumeTrustedRoute = (p) => p;

const requester = () => ({
  requestConfluence: (path, init) => dispatchConfluence(String(path), init),
  requestJira: async () => respond(404, {}),
});
export const asApp = requester;
export const asUser = requester;
export const __requestAtlassianAsApp = async () => respond(404, {});
export const webTrigger = { getUrl: async () => "https://fake.invalid/webtrigger" };
export const getAppContext = () => ({ appAri: { appId: "fake" }, environmentAri: { environmentId: "fake-env" }, environmentId: "fake-env", environmentType: "DEVELOPMENT", appVersion: "0.0.0" });
const api = { asApp, asUser, webTrigger, getAppContext };
export default api;
