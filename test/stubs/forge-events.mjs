export class Queue {
  constructor(opts) { this.name = opts?.key || "queue"; }
  async push() { return { jobId: "stub-job" }; }
  async getJob() { return { getStats: async () => ({ inProgress: 0, success: 0, failed: 0 }) }; }
}
export default { Queue };
