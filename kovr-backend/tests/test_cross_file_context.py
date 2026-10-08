"""
Tests for cross-file reference resolution (core/cross_file_context.py) and
the exact-match fix verification it feeds into (core/fix_apply.py).

Covers the 5 required cases:
1. Normal same-file function — no cross-file reference, context unaffected
2. Cross-file reference — resolves to the real implementation in another file
3. Unresolved reference — npm package / missing file, fails safely (no guess)
4. Hallucination rejection — a fabricated before_code is correctly rejected
5. Valid cross-file patch — a correct, minimal fix is successfully applied
"""

import os
import pytest
from app.core.cross_file_context import find_reference, resolve_module_path, extract_method_from_file, get_enhanced_context
from app.core.fix_apply import apply_fix_to_copy


# ---------------------------------------------------------------------------
# 1. Normal same-file function — should NOT trigger cross-file resolution
# ---------------------------------------------------------------------------
def test_same_file_function_context_unaffected():
    base_context = "function calculateTotal(items) {\n    return items.reduce((a, b) => a + b, 0);\n}"
    # No identifier.method reference on a plain function definition line —
    # get_enhanced_context should return the base context unchanged.
    line_text = "function calculateTotal(items) {"
    ref = find_reference(line_text)
    assert ref is None


# ---------------------------------------------------------------------------
# 2. Cross-file reference — resolves to the real implementation
# ---------------------------------------------------------------------------
def test_cross_file_reference_resolves_correctly(tmp_path):
    routes_dir = tmp_path / "app" / "routes"
    routes_dir.mkdir(parents=True)

    session_file = routes_dir / "session.js"
    session_file.write_text(
        "class SessionHandler {\n"
        "    displayLogoutPage(req, res) {\n"
        "        req.session.destroy(err => {\n"
        "            res.redirect('/');\n"
        "        });\n"
        "    }\n"
        "}\n"
        "module.exports = SessionHandler;\n"
    )

    index_file = routes_dir / "index.js"
    index_file.write_text(
        "const SessionHandler = require('./session');\n"
        "const sessionHandler = new SessionHandler(db);\n"
        "app.get(\"/logout\", sessionHandler.displayLogoutPage);\n"
    )

    ref = find_reference('app.get("/logout", sessionHandler.displayLogoutPage);')
    assert ref == ("sessionHandler", "displayLogoutPage")

    resolved_path = resolve_module_path(str(routes_dir), "sessionHandler", index_file.read_text())
    assert resolved_path is not None
    assert os.path.basename(resolved_path) == "session.js"

    extracted = extract_method_from_file(resolved_path, "displayLogoutPage")
    assert extracted is not None
    assert "req.session.destroy" in extracted

    base_context = 'app.get("/logout", sessionHandler.displayLogoutPage);'
    enhanced = get_enhanced_context(str(index_file), 3, base_context)
    assert "Referenced implementation" in enhanced
    assert "req.session.destroy" in enhanced


# ---------------------------------------------------------------------------
# 3. Unresolved reference — npm package or missing file, fails safely
# ---------------------------------------------------------------------------
def test_unresolved_reference_falls_back_safely(tmp_path):
    index_file = tmp_path / "index.js"
    index_file.write_text(
        "const express = require('express');\n"
        "const app = express();\n"
        "app.use(bodyParser.json());\n"
    )

    base_context = "app.use(bodyParser.json());"
    # bodyParser is not a locally-required module (no relative require found),
    # so resolution must fail safely and return the base context unchanged.
    enhanced = get_enhanced_context(str(index_file), 3, base_context)
    assert enhanced == base_context
    assert "Referenced implementation" not in enhanced


# ---------------------------------------------------------------------------
# 4. Hallucination rejection — fabricated before_code must be rejected
# ---------------------------------------------------------------------------
def test_hallucinated_before_code_is_rejected(tmp_path):
    real_file = tmp_path / "index.js"
    real_file.write_text(
        'app.get("/logout", sessionHandler.displayLogoutPage);\n'
    )

    hallucinated_before = (
        'app.get("/logout", (req, res) => {\n'
        '    req.session.destroy(err => {\n'
        '        res.redirect("/");\n'
        '    });\n'
        '});'
    )
    hallucinated_after = (
        'app.post("/logout", (req, res) => {\n'
        '    req.session.destroy(err => {\n'
        '        res.redirect("/");\n'
        '    });\n'
        '});'
    )

    fixed_path, error = apply_fix_to_copy(str(real_file), hallucinated_before, hallucinated_after)

    assert fixed_path is None
    assert error is not None
    assert error.startswith("before_code does not match file content exactly")

    # Confirm the original file was never modified.
    assert real_file.read_text() == 'app.get("/logout", sessionHandler.displayLogoutPage);\n'


# ---------------------------------------------------------------------------
# 5. Valid cross-file patch — correct, minimal fix is successfully applied
# ---------------------------------------------------------------------------
def test_valid_minimal_fix_is_applied_successfully(tmp_path):
    real_file = tmp_path / "index.js"
    real_file.write_text(
        'app.get("/logout", sessionHandler.displayLogoutPage);\n'
    )

    correct_before = 'app.get("/logout", sessionHandler.displayLogoutPage);'
    correct_after = 'app.post("/logout", sessionHandler.displayLogoutPage);'

    fixed_path, error = apply_fix_to_copy(str(real_file), correct_before, correct_after)

    assert error is None
    assert fixed_path is not None
    assert os.path.exists(fixed_path)

    fixed_content = open(fixed_path, "r", encoding="utf-8").read()
    assert "app.post(\"/logout\", sessionHandler.displayLogoutPage);" in fixed_content
    assert "app.get(\"/logout\"" not in fixed_content

    # Original file must remain untouched until verify confirms the fix.
    assert real_file.read_text() == 'app.get("/logout", sessionHandler.displayLogoutPage);\n'