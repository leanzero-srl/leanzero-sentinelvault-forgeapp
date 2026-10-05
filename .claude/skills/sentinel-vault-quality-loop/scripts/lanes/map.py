#!/usr/bin/env python3
import json, re, sys, os
S = "/private/tmp/claude-501/-Users-mihaiperdum-Projects/65f66400-8299-45c3-a493-c5c5d89b85e6/scratchpad"
ROOT = "/Users/mihaiperdum/Projects/Sentinel Vault/.claude/worktrees/sv-7-personal-data"
calls = json.load(open("calls.json"))
src = {}
def text(f):
    if f not in src: src[f] = open(os.path.join(ROOT, f)).read()
    return src[f]
# Re-derive method for routes assigned to a variable / array form.
for c in calls:
    t = text(c["file"]); lines = t.split("\n"); ln = lines[c["line"] - 1]
    m = re.search(r"(?:const|let)\s+(\w+)\s*=\s*route`", ln)
    if m:
        var = m.group(1); rest = "\n".join(lines[c["line"]:c["line"] + 60])
        um = re.search(r"requestConfluence\(\s*" + var + r"\b([^;]{0,400})", rest)
        if um:
            mm = re.search(r"method:\s*[\"'](\w+)", um.group(1)); c["method"] = mm.group(1).upper() if mm else "GET"; c["how"] = f"via {var}"
        else:
            um = re.search(r"\(\s*" + var + r"\s*,\s*\{([^}]{0,300})", rest)
            mm = re.search(r"method:\s*[\"'](\w+)", um.group(1)) if um else None
            c["method"] = mm.group(1).upper() if mm else "GET"; c["how"] = f"via {var} (wrapper)"
    if "$" == c["raw"][:1] and c["raw"].startswith("${base}"):
        c["how"] = "base-var"
v1 = json.load(open(f"{S}/conf-v1.json"))["paths"]; v2 = json.load(open(f"{S}/conf-v2.json"))["paths"]
jsm = json.load(open(f"{S}/svaudit/jsm.json"))["paths"]; assets = json.load(open(f"{S}/svaudit/assets.json"))["paths"]
def pat(p): return re.compile("^" + re.sub(r"\\\{[^}]+\\\}", "[^/]+", re.escape(p)) + "$")
specs = [("v2", "/wiki/api/v2", v2), ("v1", "", v1), ("jsm", "", jsm), ("assets", "/jsm/assets/workspace/{w}/v1", assets)]
idx = [(name, pat(pre + k), k, ops) for name, pre, sp in specs for k, ops in sp.items() for _ in [0] for ops in [sp[k]]]
def alts(op):
    out = [set(x["scopes"]) for x in (op.get("x-atlassian-oauth2-scopes") or []) if x.get("scopes")]
    if not out:
        for s in op.get("security", []) or []:
            for k, v in s.items():
                if v: out.append(set(v))
    return out
for c in calls:
    p = c["path"].replace("{x}", "X")
    c["spec"] = None
    for name, rx, k, ops in idx:
        if rx.match(p) and c["method"].lower() in ops:
            c["spec"] = f"{name} {c['method']} {k}"; c["alts"] = [sorted(a) for a in alts(ops[c["method"].lower()])]; break
json.dump(calls, open("calls-mapped.json", "w"), indent=1)
api = [c for c in calls if not re.match(r"/wiki/(pages|apps|spaces/[^/]+/pages)|.*\.action", c["path"]) and not c["path"].startswith("{x}/pages") and "viewp" not in c["path"]]
print("REST calls:", len(api), " unmatched:", sum(1 for c in api if not c["spec"]))
for c in api:
    if not c["spec"]: print("  UNMATCHED", c["file"], c["line"], c["method"], c["raw"][:100], c.get("how", ""))
