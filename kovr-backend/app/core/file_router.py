"""
Classifies each discovered file as relevant to "backend" pillars
(API Design, Backend Logic), "frontend" pillars (UI/UX), or both — so a
file is only ever sent to the AI by the pillars it's actually relevant
to, instead of every pillar re-scanning the same file independently.

Classification is content-based, not just extension-based, since .js/.ts
files are ambiguous (could be an Express route file or a React
component). Backend and frontend signal patterns are checked; a file
matching neither or both stays classified as "shared" so no pillar loses
coverage — this is a routing optimization, never a correctness cutoff.
"""
import os
import re

BACKEND_ONLY_EXTENSIONS = {
    ".py", ".go", ".java", ".rb", ".php", ".rs", ".cs", ".kt",
    ".swift", ".scala", ".dart", ".ex", ".exs", ".lua", ".pl",
}
FRONTEND_ONLY_EXTENSIONS = {
    ".jsx", ".tsx", ".html", ".htm", ".vue", ".svelte", ".astro",
    ".ejs", ".hbs", ".pug", ".css", ".scss", ".sass", ".less",
}
AMBIGUOUS_EXTENSIONS = {".js", ".ts", ".mjs", ".cjs"}

BACKEND_SIGNALS = [
    re.compile(r"\brequire\s*\("), re.compile(r"\bmodule\.exports\b"),
    re.compile(r"\bapp\.(get|post|put|delete|patch|use)\s*\("),
    re.compile(r"\brouter\.(get|post|put|delete|patch|use)\s*\("),
    re.compile(r"\bexpress\s*\("), re.compile(r"\bmongoose\b"),
    re.compile(r"\bprocess\.env\b"), re.compile(r"\bexports\.\w+\s*="),
]

FRONTEND_SIGNALS = [
    re.compile(r"\bimport\s+React\b"), re.compile(r"from\s+['\"]react['\"]"),
    re.compile(r"\buseState\s*\("), re.compile(r"\buseEffect\s*\("),
    re.compile(r"<\w+[\s>]"),  # JSX-like tag
    re.compile(r"\bdocument\.\w+"), re.compile(r"\baddEventListener\s*\("),
    re.compile(r"\bexport\s+default\s+function\b"),
]


def classify_file(file_path: str) -> set:
    """
    Returns a set containing one or both of {"backend", "frontend"} —
    which pillar groups this file is relevant to.
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext in BACKEND_ONLY_EXTENSIONS:
        return {"backend"}
    if ext in FRONTEND_ONLY_EXTENSIONS:
        return {"frontend"}
    if ext not in AMBIGUOUS_EXTENSIONS:
        return {"backend", "frontend"}  # unknown type — don't lose coverage

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(4000)  # sample enough to catch signals, not the whole file
    except Exception:
        return {"backend", "frontend"}  # can't read — don't lose coverage

    has_backend = any(p.search(content) for p in BACKEND_SIGNALS)
    has_frontend = any(p.search(content) for p in FRONTEND_SIGNALS)

    if has_backend and not has_frontend:
        return {"backend"}
    if has_frontend and not has_backend:
        return {"frontend"}
    # Neither or both signals found — ambiguous, keep in both to be safe.
    return {"backend", "frontend"}


def route_files(all_backend_candidates: list, all_frontend_candidates: list) -> dict:
    """
    Takes the raw candidate lists from find_relevant_files (backend-ish
    extensions) and find_frontend_files (frontend-ish extensions),
    classifies each unique file once, and returns which files each pillar
    group should actually scan.
    """
    combined = list(dict.fromkeys(all_backend_candidates + all_frontend_candidates))

    backend_files = []
    frontend_files = []

    for f in combined:
        classification = classify_file(f)
        if "backend" in classification:
            backend_files.append(f)
        if "frontend" in classification:
            frontend_files.append(f)

    return {"backend": backend_files, "frontend": frontend_files}