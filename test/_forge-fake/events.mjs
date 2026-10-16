// Fake @forge/events: a Queue whose push records the events (nothing consumes them).
import { fake } from "./state.mjs";

export class Queue {
  constructor({ key } = {}) { this.key = key; }
  async push(events) { (fake.queued ||= []).push({ key: this.key, events }); return { jobId: `fake-job-${Date.now()}` }; }
  getJob() { return { getStats: async () => ({ success: 0, inProgress: 0, failed: 0 }) }; }
}
