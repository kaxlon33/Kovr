import os
import re


def _read_lines(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.readlines()
    except (FileNotFoundError, IsADirectoryError):
        return None

def find_reference(line_text: str):
    """
    Find a simple `identifier.method` reference pattern on a line, e.g.
    sessionHandler.displayLogoutPage or authController.login.
    Returns (identifier, method) or None. If multiple matches exist on the
    line (e.g. app.get("/x", handler.method)), skip common framework/API
    call patterns (app, req, res, router) to prefer the real reference.
    """
    skip_identifiers = {"app", "req", "res", "console", "module", "process",
                         "JSON", "Object", "Array", "Math", "exports", "router"}

    matches = re.findall(r'\b([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\b', line_text)
    for identifier, method in matches:
        if identifier not in skip_identifiers:
            return identifier, method

    return None


def resolve_module_path(file_dir: str, identifier: str, file_content: str):
    """
    Resolve `identifier` to a local module file path, supporting the two
    common patterns:
      const identifier = require('./module')
      const ClassName = require('./module'); const identifier = new ClassName(...)
    Only relative ('./', '../') requires are resolved — npm packages are
    intentionally left alone.
    """
    module_rel_path = None

    direct = re.search(
        r'(?:const|let|var)\s+' + re.escape(identifier) + r'\s*=\s*require\(\s*[\'"](.+?)[\'"]\s*\)',
        file_content
    )
    if direct:
        module_rel_path = direct.group(1)
    else:
        instantiation = re.search(
            r'(?:const|let|var)\s+' + re.escape(identifier) + r'\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\(',
            file_content
        )
        if instantiation:
            class_name = instantiation.group(1)
            class_require = re.search(
                r'(?:const|let|var)\s+' + re.escape(class_name) + r'\s*=\s*require\(\s*[\'"](.+?)[\'"]\s*\)',
                file_content
            )
            if class_require:
                module_rel_path = class_require.group(1)

    if not module_rel_path or not module_rel_path.startswith("."):
        return None

    candidate = os.path.normpath(os.path.join(file_dir, module_rel_path))
    for suffix in ("", ".js", ".ts", os.path.join("", "index.js"), os.path.join("", "index.ts")):
        path = candidate + suffix if suffix.startswith(".") else os.path.join(candidate, suffix) if suffix else candidate
        if os.path.isfile(path):
            return path
    return None


def extract_method_from_file(referenced_path: str, method_name: str):
    """
    Extract a single method's implementation from a referenced file using
    brace counting (correct for JS/TS, unlike Python-style indentation
    scanning). Returns None if the method can't be found.
    """
    lines = _read_lines(referenced_path)
    if lines is None:
        return None

    patterns = [
        rf'this\.{re.escape(method_name)}\s*=\s*(?:function\s*\(|\([^)]*\)\s*=>|function\*?\s*\()',
        rf'^\s*{re.escape(method_name)}\s*\([^)]*\)\s*\{{',
        rf'{re.escape(method_name)}\s*:\s*function',
        rf'exports\.{re.escape(method_name)}\s*=',
    ]

    start_index = None
    for i, line in enumerate(lines):
        if any(re.search(p, line) for p in patterns):
            start_index = i
            break

    if start_index is None:
        return None

    brace_count = 0
    started = False
    end_index = start_index
    for i in range(start_index, len(lines)):
        for ch in lines[i]:
            if ch == "{":
                brace_count += 1
                started = True
            elif ch == "}":
                brace_count -= 1
        end_index = i
        if started and brace_count <= 0:
            break

    return "".join(lines[start_index:end_index + 1])


def get_enhanced_context(file_path: str, line_number: int, base_context: str) -> str:
    lines = _read_lines(file_path)
    if lines is None or line_number < 1 or line_number > len(lines):
        print(f"[cross_file] Could not read {file_path} or bad line number")
        return base_context

    target_line = lines[line_number - 1]
    ref = find_reference(target_line)
    print(f"[cross_file] target_line={target_line.strip()!r} ref={ref}")
    if not ref:
        return base_context

    identifier, method = ref
    file_content = "".join(lines)
    file_dir = os.path.dirname(file_path)

    referenced_path = resolve_module_path(file_dir, identifier, file_content)
    print(f"[cross_file] identifier={identifier} method={method} resolved_path={referenced_path}")
    if not referenced_path:
        return base_context

    referenced_function = extract_method_from_file(referenced_path, method)
    print(f"[cross_file] extracted_function_found={referenced_function is not None}")
    if not referenced_function:
        return base_context

    referenced_filename = os.path.basename(referenced_path)
    return (
        f"{base_context}\n\n"
        f"# Referenced implementation ({identifier}.{method} is defined in {referenced_filename}). "
        f"This is for UNDERSTANDING ONLY — the file that will actually be patched is the current file above.\n"
        f"{referenced_function}"
    )