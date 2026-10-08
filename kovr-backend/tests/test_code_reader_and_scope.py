import pytest
from app.core.code_reader import get_function_context
from app.core.scope import resolve_scope

def test_express_route_handler_extraction(tmp_path):
    js_file = tmp_path / "routes.js"
    js_file.write_text(
        "const express = require('express');\n"
        "const router = express.Router();\n"
        "\n"
        "// GET /api/users\n"
        "router.get('/api/users', async (req, res, next) => {\n"
        "    try {\n"
        "        const users = await db.query('SELECT * FROM users');\n"
        "        res.json(users);\n"
        "    } catch (err) {\n"
        "        next(err);\n"
        "    }\n"
        "});\n"
    )
    context = get_function_context(str(js_file), 6)
    assert "router.get('/api/users'" in context
    assert "res.json(users);" in context
    assert "});" in context

    context_from_comment = get_function_context(str(js_file), 4)
    assert "router.get('/api/users'" in context_from_comment
    assert "res.json(users);" in context_from_comment

    context_from_line1 = get_function_context(str(js_file), 1)
    assert "router.get('/api/users'" in context_from_line1

def test_redirect_scope_detection():
    assert resolve_scope("redirect", "Some Issue", "Some Description") == "redirect"
    assert resolve_scope("local", "Unversioned API endpoints", "Routes are missing version prefix") == "redirect"
    assert resolve_scope("local", "Missing API versioning", "Endpoints should be versioned") == "redirect"
    assert resolve_scope("local", "Router mount prefix missing", "Mount point lacks version") == "redirect"
    # Codebase-wide umbrellas are reserved for high/critical severity —
    # info/warning findings must always stay directly fixable (local).
    assert (
        resolve_scope(
            "local", "Inconsistent naming convention", "Use consistent naming across files", severity="high"
        )
        == "codebase_wide"
    )
    assert (
        resolve_scope(
            "codebase_wide", "Inconsistent naming convention", "Use consistent naming across files", severity="medium"
        )
        == "local"
    )
    assert (
        resolve_scope(
            "local", "Inconsistent naming convention", "Use consistent naming across files", severity="low"
        )
        == "local"
    )
    assert resolve_scope("local", "Missing error handling", "Missing try catch block") == "local"
