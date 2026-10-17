// Fake @forge/llm. Every chat() call is recorded on fake.llmCalls, so a test can prove that a
// path made NO model call (the AI ceiling: test/ai-ceiling.test.mjs). A scenario that wants an
// answer sets fake.llm to a function; with none set the call throws, as it always did.
import { fake } from "./state.mjs";

export const chat = async (prompt) => {
  (fake.llmCalls ||= []).push(prompt);
  if (typeof fake.llm === "function") return fake.llm(prompt);
  throw new Error("fake llm: not implemented");
};
export const list = async () => ({ models: [] });
