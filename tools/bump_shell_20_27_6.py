#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "public"
idx = root / "index.html"
text = idx.read_text(encoding="utf-8")
text = text.replace("?v=20.27.4", "?v=20.27.6")
text = text.replace("?v=20.27.5", "?v=20.27.6")
text = text.replace(
    "window.ASGARD_SHELL_VERSION = '20.27.5'",
    "window.ASGARD_SHELL_VERSION = '20.27.6'",
)
idx.write_text(text, encoding="utf-8")

sw = root / "sw.js"
swt = sw.read_text(encoding="utf-8")
swt = swt.replace(
    "const SHELL_VERSION = '20.27.5'",
    "const SHELL_VERSION = '20.27.6'",
)
sw.write_text(swt, encoding="utf-8")
print("ok", text.count("20.27.6"), "occurrences in index")
