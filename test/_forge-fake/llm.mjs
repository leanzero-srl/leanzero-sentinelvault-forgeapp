// Fake @forge/llm: never reached by the workflow paths; present so imports resolve.
export const chat = async () => { throw new Error("fake llm: not implemented"); };
export const list = async () => ({ models: [] });
