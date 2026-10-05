import json, re
ROOT = "/Users/mihaiperdum/Projects/Sentinel Vault/.claude/worktrees/sv-7-personal-data"
calls = json.load(open("calls-mapped.json"))
M = {  # manual resolutions for paths the spec matcher could not place
 "base-var-props": None,
}
P = lambda s: [sorted(s)]
for c in calls:
    r = c["raw"]
    if c["spec"]: continue
    if r.startswith("${base}/properties"):
        # base = /wiki/api/v2/pages/{id} or /wiki/api/v2/spaces/{id} (classification/logic.js mirrorProperty, config-api/mirror.js)
        w = c["method"] != "GET"
        c["spec"] = f"v2 {c['method']} /pages|spaces/{{id}}/properties (base var)"
        c["alts"] = [["read:page:confluence"] + (["write:page:confluence"] if w else []), ["read:space:confluence"] + (["write:space:confluence"] if w else [])]
        c["anyOf"] = True  # page OR space branch: each is its own call
    elif "contentbody/convert/atlas_doc_format" in r:
        c["spec"] = "v1 POST /wiki/rest/api/contentbody/convert/{to} (sync; dropped from the current spec, measured 200 live 2026-10-04)"
        c["alts"] = [["read:confluence-content.all"], ["read:content.metadata:confluence"]]; c["assumed"] = True
    elif r.startswith("/rest/api/group"):
        c["spec"] = "v1 GET /wiki/rest/api/group (path lacks /wiki)"; c["alts"] = [["read:confluence-groups"], ["read:group:confluence"]]
    elif "${collection}" in r:
        c["spec"] = "v2 GET /pages|blogposts/{id}/attachments"; c["alts"] = [["read:attachment:confluence"]]
    elif r.startswith("/app/report-accounts"):
        c["spec"] = "Forge POST /app/report-accounts (Personal Data Reporting, via __requestAtlassianAsApp)"; c["alts"] = [["report:personal-data"]]
    elif "/permission/check" in r and "/space/" in r:
        c["spec"] = "v1 POST /wiki/rest/api/space/{key}/permission/check (not in the current spec; measured 401 2026-10-04, fail-closed)"; c["alts"] = []
json.dump(calls, open("calls-final.json", "w"), indent=1)
man = open(f"{ROOT}/manifest.yml").read().split("  scopes:\n")[1].split("  content:")[0]
held = set(re.findall(r"^    - ([a-z:.\-]+)\s*$", man, re.M))
CAND = ["read:confluence-content.summary", "read:confluence-space.summary", "read:confluence-props", "read:content:confluence",
     "write:content:confluence", "read:comment:confluence", "read:content.property:confluence", "write:content.property:confluence",
     "read:content.restriction:confluence", "read:label:confluence",
     "write:attachment:confluence", "write:content.restriction:confluence", "read:content.metadata:confluence", "read:content.permission:confluence"]
api = [c for c in calls if c.get("spec")]
print("held", len(held))
for s in CAND:
    deps = [c for c in api if c.get("alts") and any(set(a) <= held for a in c["alts"]) and not any(set(a) <= held - {s} for a in c["alts"])]
    print(f"{s}: {len(deps)} call(s) need it", [f"{c['file'].split('/')[-1]}:{c['line']} {c['method']} {c['spec'][:60]}" for c in deps][:6])
rem = held - set(CAND)
broken = [c for c in api if c.get("alts") and any(set(a) <= held for a in c["alts"]) and not any(set(a) <= rem for a in c["alts"])]
print("JOINT removal breaks:", [(c["file"], c["line"], c["method"], c["spec"]) for c in broken])
unsat = [c for c in api if c.get("alts") and not any(set(a) <= held for a in c["alts"])]
print("already unsatisfied with FULL held set:", [(c["file"], c["line"], c["method"], c["spec"][:70], c["alts"]) for c in unsat])
