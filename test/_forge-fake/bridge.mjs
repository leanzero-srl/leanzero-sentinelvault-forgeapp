// Fake @forge/bridge for test/action-log.test.mjs: `invoke` records what the UI sent and answers
// with what the test set (or rejects). Registered by test/_forge-fake/bridge-loader.mjs only.
export const calls = [];
let answer = async () => ({ success: true });
export const setAnswer = (fn) => { answer = fn; };
export const invoke = (key, payload) => { calls.push({ key, payload }); return answer(key, payload); };
export const view = { getContext: async () => ({}) };
export const router = { open: async () => {} };
export const showFlag = () => ({ close: () => {} });
