"""
Classifies whether a finding is fixable by patching a single function
within the file it was found in (local), or only fixable by also editing
a DIFFERENT file (codebase_wide). The AI's own classification is backed
up by a keyword check — but the keyword check now requires BOTH a
consistency-style word AND an explicit cross-file signal, since a bare
mention of "consistent" is common even for issues fully fixable in one
file (e.g. "use consistent casing" within a single function).

Severity gate: an unfixable codebase-wide umbrella is only justified for
genuinely architectural issues. Low/medium findings ("info" and
"warning" in the UI) must ALWAYS be directly solvable — they are forced
to a single-file scope and flow through the normal fix pipeline, so a
"codebase-wide" entry can never appear in those lists.
"""

CONSISTENCY_WORDS = [
    "consisten", "convention", "pattern used",
]

CROSS_FILE_SIGNALS = [
    "other file", "other files", "elsewhere in the codebase", "across files",
    "across modules", "across the project", "across the codebase",
    "in another file", "in other modules", "shared config", "defined elsewhere",
    "every file", "all files", "throughout the codebase", "throughout the project",
    "project-wide", "system-wide", "codebase-wide",
]

REDIRECT_KEYWORDS = [
    "unversioned", "versioning", "api version", "version prefix", "route mounting",
    "router mount", "mount point", "app.use",
]

# Only these severities may be classified as an architectural umbrella.
ARCHITECTURAL_SEVERITIES = {"high", "critical"}


def keyword_suggests_redirect(text: str) -> bool:
    lower = (text or "").lower()
    return any(kw in lower for kw in REDIRECT_KEYWORDS)


def keyword_suggests_codebase_wide(text: str) -> bool:
    lower = (text or "").lower()
    has_consistency_word = any(kw in lower for kw in CONSISTENCY_WORDS)
    has_cross_file_signal = any(kw in lower for kw in CROSS_FILE_SIGNALS)
    return has_consistency_word and has_cross_file_signal


def resolve_scope(ai_scope: str, title: str, description: str, severity: str = None) -> str:
    combined = f"{title} {description}"
    if ai_scope == "redirect" or keyword_suggests_redirect(combined):
        return "redirect"
    if (severity or "").lower() not in ARCHITECTURAL_SEVERITIES:
        # Info/warning-level findings must always be directly fixable in
        # one file — never an unfixable codebase-wide umbrella.
        return "local"
    if ai_scope == "codebase_wide":
        return "codebase_wide"
    if keyword_suggests_codebase_wide(combined):
        return "codebase_wide"
    return "local"