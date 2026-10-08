import re


def _extract_keywords(text: str):
    if not text:
        return []
    keywords = set()
    for m in re.findall(r'["\']([^"\']{3,40})["\']', text):
        keywords.add(m.lower())
    stopwords = {"this", "that", "with", "from", "should", "which", "does",
                 "when", "code", "issue", "endpoint", "request", "response"}
    for m in re.findall(r'\b[a-zA-Z_][a-zA-Z0-9_]{3,}\b', text):
        word = m.lower()
        if word not in stopwords:
            keywords.add(word)
    return list(keywords)


def locate_relevant_line(file_path: str, approx_line: int, title: str = "", description: str = "", window: int = 25):
    """
    Line numbers from AI-only pillars (no dedicated static-analysis tool)
    are estimates and can be inaccurate. Search a window of lines around
    the reported line for the best keyword match against the finding's
    title/description, and return the closest genuinely-matching line.
    Falls back to approx_line unchanged if nothing scores better.

    Exact call anchors win over keywords first: when the finding names a
    concrete call like "connectDB() is invoked without error handling",
    the line that actually invokes it is the issue location — keyword
    scoring alone drifts to whichever nearby line mentions the most
    words (e.g. a static-file route handler).
    """
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return approx_line

    if not lines or not approx_line:
        return approx_line or 1

    text = f"{title} {description}"

    # Anchor pass: explicit name() mentions in the finding text.
    anchor_symbols = [
        s for s in dict.fromkeys(re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]{2,})\s*\(\s*\)", text))
        if s not in {"the", "and", "for", "not", "with"}
    ]
    if anchor_symbols:
        start = max(0, approx_line - 1 - window)
        end = min(len(lines), approx_line - 1 + window)
        anchor_line = None
        for i in range(start, end):
            for symbol in anchor_symbols:
                if re.search(rf"\b{re.escape(symbol)}\s*\(", lines[i]):
                    if anchor_line is None or abs((i + 1) - approx_line) < abs(anchor_line - approx_line):
                        anchor_line = i + 1
        if anchor_line is not None:
            return anchor_line

    keywords = _extract_keywords(text)
    if not keywords:
        return approx_line

    start = max(0, approx_line - 1 - window)
    end = min(len(lines), approx_line - 1 + window)

    best_line = approx_line
    best_score = 0.0
    for i in range(start, end):
        line_lower = lines[i].lower()
        score = sum(1 for kw in keywords if kw in line_lower)
        if score == 0:
            continue
        distance_penalty = abs((i + 1) - approx_line) * 0.01
        adjusted = score - distance_penalty
        if adjusted > best_score:
            best_score = adjusted
            best_line = i + 1

    return best_line

def get_code_context(file_path: str, line_number: int, context_lines: int = 3):
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return ""

    start = max(0, line_number - 1 - context_lines)
    end = min(len(lines), line_number + context_lines)

    snippet_lines = lines[start:end]
    return "".join(snippet_lines)


# Matches Python "def", Ruby "def", and common function shapes across
# JS/TS, Go, Rust, PHP, Java/C#, Kotlin and Swift:
#   function foo(...) {           exports.foo = function(...) {
#   const foo = (...) => {        foo: function(...) {
#   async function foo(...) {     exports.foo = async (...) => {
FUNCTION_START_PATTERNS = [
    re.compile(r'^\s*def\s'),  # Python, Ruby
    re.compile(r'^\s*(export\s+)?(default\s+)?(async\s+)?function\s'),
    re.compile(r'^\s*(exports\.\w+|module\.exports(\.\w+)?)\s*=\s*(async\s*)?function'),
    re.compile(r'^\s*(exports\.\w+|module\.exports(\.\w+)?)\s*=\s*(async\s*)?\('),
    re.compile(r'^\s*(const|let|var)\s+\w+\s*=\s*(async\s*)?\([^)]*\)\s*=>'),
    re.compile(r'^\s*\w+\s*:\s*(async\s*)?function'),
    # Go / Swift
    re.compile(r'^\s*func\s'),
    # Rust
    re.compile(r'^\s*(pub\s+)?(async\s+)?(unsafe\s+)?fn\s'),
    # PHP
    re.compile(r'^\s*(public|private|protected)\s+(static\s+)?function\s'),
    re.compile(r'^\s*function\s+\w+\s*\('),
    # Kotlin
    re.compile(r'^\s*(private\s+|internal\s+)?(suspend\s+)?fun\s'),
    # Java / C# — modifiers + return type + name + params
    re.compile(r'^\s*(public|private|protected|internal)\s+(static\s+|final\s+|abstract\s+|override\s+|virtual\s+|async\s+)*[\w<>\[\],?.\s]+\s+\w+\s*\([^)]*\)\s*\{?\s*$'),
    # Express/router-style route handlers: supports app, router, api, usersRouter, etc.
    re.compile(r'^\s*(\w+Router|app|router|api|route|server)\.(get|post|put|delete|patch|use|all|options)\s*\('),
]


def _is_function_start(line: str) -> bool:
    return any(p.search(line) for p in FUNCTION_START_PATTERNS)


def get_function_context(file_path: str, line_number: int):
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return ""

    if not lines:
        return ""

    target_index = max(0, min(line_number - 1 if line_number else 0, len(lines) - 1))

    # If the targeted line is at the very beginning of the file (e.g. imports or line 1 fallback),
    # search forward first to find the first actual route handler or function definition
    start = target_index
    if start == 0 and not _is_function_start(lines[0]):
        for idx in range(min(50, len(lines))):
            if _is_function_start(lines[idx]):
                start = idx
                break

    # If we started deeper in the file, walk upward to find the enclosing function/route start
    if not _is_function_start(lines[start]):
        while start > 0 and not _is_function_start(lines[start]):
            start -= 1

    # If walking upward didn't find a function start, search downward (e.g. comment/decorator right before function)
    if not _is_function_start(lines[start]):
        for offset in range(1, min(15, len(lines) - target_index)):
            if _is_function_start(lines[target_index + offset]):
                start = target_index + offset
                break

    if not _is_function_start(lines[start]):
        # No function found, fall back to simple context
        return get_code_context(file_path, line_number)

    is_python = lines[start].lstrip().startswith("def ")

    if is_python:
        def_indent = len(lines[start]) - len(lines[start].lstrip())
        end = start + 1
        while end < len(lines):
            line = lines[end]
            if line.strip() == "":
                end += 1
                continue
            current_indent = len(line) - len(line.lstrip())
            if current_indent <= def_indent:
                break
            end += 1
    else:
        # JS/TS: track both brace depth and parenthesis depth to avoid early exit on object literals
        end = start
        brace_depth = 0
        paren_depth = 0
        started = False

        while end < len(lines):
            for ch in lines[end]:
                if ch == "{" or ch == "(":
                    if ch == "{":
                        brace_depth += 1
                    else:
                        paren_depth += 1
                    started = True
                elif ch == "}" or ch == ")":
                    if ch == "}":
                        brace_depth -= 1
                    else:
                        paren_depth -= 1

            end += 1
            if started and brace_depth <= 0 and paren_depth <= 0:
                break

        # Fallback window if parsing terminated on a single-line edge case
        MIN_CONTEXT_LINES = 15
        if (end - start) < 3 and len(lines) > start + MIN_CONTEXT_LINES:
            end = min(len(lines), start + MIN_CONTEXT_LINES)

    return "".join(lines[start:end])