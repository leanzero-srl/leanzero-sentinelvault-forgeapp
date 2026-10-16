// Fake @forge/resolver: collects define() calls so registry.js can be imported.
export default class Resolver {
  constructor() { this.defs = new Map(); }
  define(key, fn) { this.defs.set(key, fn); }
  getDefinitions() { return this.defs; }
}
