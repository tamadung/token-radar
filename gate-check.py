#!/usr/bin/env python3
"""Local gate-check for token-radar-01 (reproduces the 7 scorer rows from RULES.txt).
Usage: python3 gate-check.py [out_dir]  (default: out)
Exit 0 when all 7 pass, else 1. Prints each row PASS/FAIL with its detail.
"""
import json, os, re, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
SNAP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "token-radar-01-kit", "input", "snapshot.json")
fails = []

def check(name, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        fails.append(name)

# --- load snapshot ---
snap = json.load(open(SNAP))
watchlist = set(snap["watchlist"])
proto_slugs = {p["slug"] for p in snap["protocols"]}

# 1. dashboard_files
dash = os.path.join(OUT, "dashboard")
files = []
total = 0
bad_name = None
url_offender = None
if os.path.isdir(dash):
    for root, _, names in os.walk(dash):
        for n in names:
            if n.startswith("."):
                continue
            p = os.path.join(root, n)
            if not os.path.isfile(p):
                continue
            rel = os.path.relpath(p, dash)
            if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", n) or n.startswith((".", "-")) or "/." in "/" + rel:
                bad_name = rel
            total += os.path.getsize(p)
            files.append(rel)
            # no http/https in HTML attrs, CSS, JS imports
            try:
                txt = open(p, encoding="utf-8", errors="ignore").read()
            except Exception:
                txt = ""
            if n.endswith((".html", ".css", ".js")):
                # attribute values / import specifiers / css url()
                if re.search(r'(href|src|action)\s*=\s*["\']https?://', txt) or \
                   re.search(r'@(import|import)\s+["\']https?://', txt) or \
                   re.search(r'from\s+["\']https?://', txt) or \
                   re.search(r'url\(\s*["\']?https?://', txt) or \
                   re.search(r'require\(\s*["\']https?://', txt):
                    url_offender = rel
    has_html = os.path.isfile(os.path.join(dash, "index.html"))
    has_css = any(f.endswith(".css") for f in files)
    has_js = any(f.endswith(".js") for f in files)
else:
    has_html = has_css = has_js = False
ok = has_html and has_css and has_js and len(files) <= 400 and total <= 4 * 1024 * 1024 and not bad_name and not url_offender
check("dashboard_files", ok, f"{len(files)} files, {total} bytes, html={has_html} css={has_css} js={has_js}" + (f", bad name {bad_name}" if bad_name else "") + (f", url in {url_offender}" if url_offender else ""))

# 2. board_file
bpath = os.path.join(OUT, "board.json")
rows = []
board_ok = True
detail = ""
try:
    data = json.load(open(bpath, encoding="utf-8"))
    rows = data["rows"] if isinstance(data, dict) else data
    if not (100 <= len(rows) <= 4000):
        board_ok = False; detail = f"{len(rows)} rows"
    if os.path.getsize(bpath) > 8 * 1024 * 1024:
        board_ok = False; detail = "board.json > 8 MiB"
    for r in rows:
        if r["slug"] not in proto_slugs:
            board_ok = False; detail = f"invented slug {r['slug']}"; break
        if not r.get("name") or not isinstance(r.get("rank"), int) or r["rank"] < 1:
            board_ok = False; detail = f"bad rank/name on {r['slug']}"; break
        iv = r.get("implied_value_usd")
        if not isinstance(iv, int) or iv <= 0 or iv > 10**14:
            board_ok = False; detail = f"bad implied value on {r['slug']}"; break
        fs = r.get("farm_steps")
        if not isinstance(fs, list) or not (3 <= len(fs) <= 12) or any(not (20 <= len(s.strip()) <= 600) for s in fs):
            board_ok = False; detail = f"bad farm_steps on {r['slug']}"; break
    if board_ok:
        detail = f"{len(rows)} rows"
except Exception as e:
    board_ok = False; detail = str(e)
check("board_file", board_ok, detail)

# 3. sorted_by_value
ok = True; detail = ""
if rows:
    ranks = sorted(r["rank"] for r in rows)
    if ranks != list(range(1, len(rows) + 1)):
        ok = False; detail = "ranks are not 1..N"
    else:
        by_rank = sorted(rows, key=lambda r: r["rank"])
        for i in range(1, len(by_rank)):
            if by_rank[i]["implied_value_usd"] > by_rank[i - 1]["implied_value_usd"]:
                ok = False; detail = f"row {i+1} outranks row {i}"; break
        if ok and len(rows) >= 2 and by_rank[0]["implied_value_usd"] == by_rank[-1]["implied_value_usd"]:
            ok = False; detail = "all rows share one implied value"
    if ok:
        detail = f"{len(rows)} rows, rank 1 = ${by_rank[0]['implied_value_usd']:,}"
check("sorted_by_value", ok, detail)

# 4. coverage
have = {r["slug"] for r in rows}
missing = watchlist - have
check("coverage", not missing, f"{len(watchlist)} watchlist slugs, missing {len(missing)}" + (f": {sorted(missing)[:5]}" if missing else ""))

# 5. farm_steps (already partly in board_file; repeat as its own row)
ok = True; detail = ""
for r in rows:
    fs = r.get("farm_steps", [])
    if not (3 <= len(fs) <= 12) or any(not (20 <= len(s.strip()) <= 600) for s in fs):
        ok = False; detail = f"{r['slug']} bad farm_steps"; break
if ok:
    detail = f"{len(rows)} rows, all 3..12 steps of 20..600 chars"
check("farm_steps", ok, detail)

# 6. screenshots
shots = os.path.join(OUT, "screenshots")
names = sorted(n for n in os.listdir(shots) if not n.startswith(".")) if os.path.isdir(shots) else []
ok = True; detail = ""
if not (3 <= len(names) <= 4):
    ok = False; detail = f"{len(names)} images"
else:
    for n in names:
        p = os.path.join(shots, n)
        if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9._-]{0,127}", n):
            ok = False; detail = f"bad name {n}"; break
        if os.path.getsize(p) > 512 * 1024:
            ok = False; detail = f"{n} > 512 KiB"; break
        with open(p, "rb") as fh:
            head = fh.read(24)
        is_png = head[:8] == b"\x89PNG\r\n\x1a\n"
        is_jpg = head[:3] == b"\xff\xd8\xff"
        if not (is_png or is_jpg):
            ok = False; detail = f"{n} is not a whole PNG/JPEG"; break
        # dimensions
        w = h = None
        if is_png and len(head) >= 24:
            w = int.from_bytes(head[16:20], "big"); h = int.from_bytes(head[20:24], "big")
        elif is_jpg:
            fh.seek(0); data = fh.read()
            i = 2
            while i < len(data) - 9:
                if data[i] != 0xFF:
                    i += 1; continue
                m = data[i + 1]
                if m in (0xC0, 0xC1, 0xC2):
                    h = int.from_bytes(data[i + 5:i + 7], "big"); w = int.from_bytes(data[i + 7:i + 9], "big"); break
                seg = int.from_bytes(data[i + 2:i + 4], "big")
                i += 2 + seg
        if w is None or max(w, h) > 1440 or min(w, h) < 800:
            ok = False; detail = f"{n} is {w}x{h} (long<=1440, short>=800)"; break
    if ok:
        detail = f"{len(names)} images"
check("screenshots", ok, detail)

# 7. dossier_matches
ok = True; detail = ""
dpath = os.path.join(OUT, "dossier.json")
try:
    import subprocess
    r = subprocess.run(
        ["node", "dossier-check.mjs", OUT],
        capture_output=True, text=True, cwd=os.path.dirname(os.path.abspath(__file__)),
    )
    ok = r.stdout.strip().split("\n")[0] == "MATCH"
    detail = (r.stdout.strip().split("\n")[0] or r.stderr.strip()[:200])
    if os.path.getsize(dpath) > 1.5 * 1024 * 1024:
        ok = False; detail = "dossier > 1.5 MiB"
except Exception as e:
    ok = False; detail = str(e)
check("dossier_matches", ok, detail)

print()
print("GATE: " + ("7/7 PASS" if not fails else f"FAIL ({len(fails)} failed: {', '.join(fails)})"))
sys.exit(0 if not fails else 1)
