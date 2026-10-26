"""Converts client-web chat-background SVGs into Android asset files.

Output format (one drawable per line):  "a b c d e f|<svg path data>"
with every element's ancestor+own transform baked into the matrix, circles/ellipses/rects turned into path data,
and a first line "#viewbox W H". Stroke style is uniform in the sources (3 units, round caps/joins, no fill).
"""
import math, re, sys, xml.etree.ElementTree as ET

import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "..", "client-web", "src", "assets", "patterns")
DST = os.path.join(ROOT, "app", "src", "main", "assets", "patterns")
NS = "{http://www.w3.org/2000/svg}"

def mul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (a*A + c*B, b*A + d*B, a*C + c*D, b*C + d*D, a*E + c*F + e, b*E + d*F + f)

def parse_t(s):
    m = (1, 0, 0, 1, 0, 0)
    for name, args in re.findall(r"(\w+)\s*\(([^)]*)\)", s or ""):
        v = [float(x) for x in re.split(r"[\s,]+", args.strip()) if x]
        if name == "matrix": t = tuple(v)
        elif name == "translate": t = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
        elif name == "scale": t = (v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0)
        elif name == "rotate":
            r = math.radians(v[0]); c, s = math.cos(r), math.sin(r)
            t = (c, s, -s, c, 0, 0)
            if len(v) == 3:
                t = mul(mul((1, 0, 0, 1, v[1], v[2]), t), (1, 0, 0, 1, -v[1], -v[2]))
        else: raise SystemExit("unsupported transform " + name)
        m = mul(m, t)
    return m

def ellipse_d(cx, cy, rx, ry):
    return f"M{cx-rx} {cy}a{rx} {ry} 0 1 0 {2*rx} 0a{rx} {ry} 0 1 0 {-2*rx} 0z"

def walk(el, m, out):
    m = mul(m, parse_t(el.get("transform")))
    tag = el.tag.replace(NS, "")
    d = None
    if tag == "path": d = el.get("d")
    elif tag == "circle": d = ellipse_d(float(el.get("cx", 0)), float(el.get("cy", 0)), float(el.get("r")), float(el.get("r")))
    elif tag == "ellipse": d = ellipse_d(float(el.get("cx", 0)), float(el.get("cy", 0)), float(el.get("rx")), float(el.get("ry")))
    elif tag in ("line", "polyline", "polygon", "rect"): raise SystemExit("unsupported element " + tag)
    if d:
        out.append(" ".join(f"{x:.5g}" for x in m) + "|" + d.strip())
    for ch in el: walk(ch, m, out)

for name in ("animals", "space", "games", "sweets"):
    root = ET.parse(f"{SRC}\\{name}.svg").getroot()
    vb = root.get("viewBox").split()
    out = []
    walk(root, (1, 0, 0, 1, 0, 0), out)
    import os
    os.makedirs(DST, exist_ok=True)
    with open(f"{DST}\\{name}.txt", "w", encoding="utf-8", newline="\n") as fh:
        fh.write(f"#viewbox {vb[2]} {vb[3]}\n" + "\n".join(out) + "\n")
    print(name, len(out), os.path.getsize(f"{DST}\\{name}.txt"))
