"""
Cheap, non-AI pre-filter: before spending an AI call scanning a file,
check whether it even plausibly contains something relevant to the
pillar. This is intentionally permissive (biased toward "scan it" when
uncertain) — the goal is to skip files with an obvious NO, not to
replace the AI's judgment on borderline cases.
"""
import re

API_DESIGN_SIGNALS = [
    re.compile(r"\b(app|router)\.(get|post|put|delete|patch|use|options|all)\s*\("),
    re.compile(r"@(Get|Post|Put|Delete|Patch|Options)Mapping"),  # Java/Spring
    re.compile(r"@(app\.route|api\.route)", re.IGNORECASE),  # Flask/FastAPI-style decorators
    re.compile(r"\bdef\s+\w+\s*\(.*(request|req)\b"),  # Python view functions
    re.compile(r"\bres\.(json|status|send|end)\s*\("),
    re.compile(r"\bexports\.\w+\s*=\s*(async\s*)?function"),
    re.compile(r"\bAPIRouter\s*\("),  # FastAPI
    re.compile(r"\bswagger\b", re.IGNORECASE), re.compile(r"\bopenapi\b", re.IGNORECASE),
    re.compile(r"\bgraphql\b", re.IGNORECASE), re.compile(r"\btype\s+Query\b"),  # GraphQL schema
    re.compile(r"\bendpoint\b", re.IGNORECASE), re.compile(r"\bapi[_-]?version\b", re.IGNORECASE),
    re.compile(r"\.proto['\"]"), re.compile(r"\bservice\s+\w+\s*\{"),  # gRPC/protobuf
    re.compile(r"\bcontroller\b", re.IGNORECASE),
]

BACKEND_LOGIC_SIGNALS = [
    re.compile(r"\btry\s*\{"), re.compile(r"\bcatch\s*\("),
    re.compile(r"\bawait\s+\w+\."), re.compile(r"\.(find|save|update|delete|query|create)\s*\("),
    re.compile(r"\bif\s*\(.*err"), re.compile(r"\bthrow\b"),
    re.compile(r"\bdef\s+\w+\s*\("),
    re.compile(r"\bclass\s+\w+"), re.compile(r"\bfunction\s+\w+\s*\("),
    re.compile(r"\basync\s+function\b"), re.compile(r"\bexception\b", re.IGNORECASE),
    re.compile(r"\blog(ger)?\.\w+\s*\("), re.compile(r"\bconsole\.(log|error|warn)\s*\("),
    re.compile(r"\btransaction\b", re.IGNORECASE), re.compile(r"\bvalidate\b", re.IGNORECASE),
]

UI_UX_SIGNALS = [
    re.compile(r"<\w+[\s>/]"),  # JSX/HTML-like tag
    re.compile(r"\bonClick\s*="), re.compile(r"\bonSubmit\s*="), re.compile(r"\bonChange\s*="),
    re.compile(r"\bbutton\b", re.IGNORECASE), re.compile(r"\bform\b", re.IGNORECASE),
    re.compile(r"\bimg\b", re.IGNORECASE), re.compile(r"\balt\s*="),
    re.compile(r"\buseState\s*\("), re.compile(r"\buseEffect\s*\("),
    re.compile(r"\bcomponent\b", re.IGNORECASE), re.compile(r"\btemplate\b", re.IGNORECASE),
    re.compile(r"\.css['\"]"), re.compile(r"\bclassName\s*="), re.compile(r"\bclass\s*="),
    re.compile(r"\bmodal\b", re.IGNORECASE), re.compile(r"\bloading\b", re.IGNORECASE),
]

PILLAR_SIGNALS = {
    "api_design": API_DESIGN_SIGNALS,
    "backend_logic": BACKEND_LOGIC_SIGNALS,
    "ui_ux": UI_UX_SIGNALS,
}


def is_relevant_to_pillar(content: str, pillar: str) -> bool:
    """
    Returns False only when NONE of the pillar's signal patterns appear
    anywhere in the file — a strong, cheap signal that an AI call would
    be wasted. Returns True (scan it) in every other case, including
    when the pillar has no defined signals.
    """
    signals = PILLAR_SIGNALS.get(pillar)
    if not signals:
        return True
    return any(p.search(content) for p in signals)