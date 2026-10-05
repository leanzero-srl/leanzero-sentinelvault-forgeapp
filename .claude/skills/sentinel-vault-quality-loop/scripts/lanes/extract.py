#!/usr/bin/env python3
"""Enumerate every outgoing Atlassian REST call in src/ (backend + UI) of the SV worktree."""
import os, re, json, sys
ROOT = "/Users/mihaiperdum/Projects/Sentinel Vault/.claude/worktrees/sv-7-personal-data"
OUT = os.path.dirname(os.path.abspath(__file__))
calls = []
PATH_RX = re.compile(r"`((?:\$\{base\}|\$\{[a-zA-Z]+Base\}|/wiki/|/rest/|/jsm/|/gateway/)[^`]*)`|\"((?:/wiki/|/rest/|/jsm/|/app/)[^\"]*)\"")
for d, _, fs in os.walk(f"{ROOT}/src"):
    for f in fs:
        if not f.endswith((".js", ".jsx")): continue
        p = os.path.join(d, f); rel = os.path.relpath(p, ROOT)
        txt = open(p).read()
        for m in PATH_RX.finditer(txt):
            raw = m.group(1) or m.group(2)
            line = txt[: m.start()].count("\n") + 1
            # the enclosing call: walk back to the unmatched '('
            depth, i = 0, m.start() - 1
            while i >= 0:
                c = txt[i]
                if c == ")": depth += 1
                elif c == "(":
                    if depth == 0: break
                    depth -= 1
                elif c in ";{}" and depth == 0 and txt[i-1:i+1] != "${": break
                i -= 1
            callee = re.search(r"([\w.\]\)\(]+)\s*$", txt[max(0, i-80):i]) if i >= 0 and txt[i] == "(" else None
            callee = callee.group(1) if callee else "?"
            # forward to the matching ')'
            j, depth = m.end(), 0
            while j < len(txt) and j < m.end() + 1500:
                c = txt[j]
                if c == "(": depth += 1
                elif c == ")":
                    if depth == 0: break
                    depth -= 1
                j += 1
            span = txt[m.end():j]
            mm = re.search(r"method:\s*[\"'](\w+)[\"']", span)
            method = mm.group(1).upper() if mm else ("?VAR" if re.search(r"method[:,]", span) else "GET")
            mode = "asUser" if "asUser" in txt[max(0, i-60):i+1] else ("asApp" if "asApp" in txt[max(0, i-60):i+1] else "wrapper")
            path = raw.split("?")[0]
            path = re.sub(r"\$\{[^}]+\}", "{x}", path)
            calls.append({"file": rel, "line": line, "method": method, "raw": raw[:160], "path": path, "callee": callee[-40:], "mode": mode,
                          "devOnly": rel == "src/test-hook.js"})
json.dump(calls, open(f"{OUT}/calls.json", "w"), indent=1)
print(len(calls), "path literals;", sum(1 for c in calls if c["devOnly"]), "in the dev-only hook")
from collections import Counter
print(Counter(c["callee"] for c in calls).most_common(30))
