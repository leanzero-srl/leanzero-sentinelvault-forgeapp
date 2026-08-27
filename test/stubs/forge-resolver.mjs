export default class Resolver {
  constructor() { this.defs = {}; }
  define(key, fn) { this.defs[key] = fn; return this; }
  getDefinitions() { return this.defs; }
}
