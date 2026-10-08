"""
Deterministic syntax gate for generated fixes.

Runs BEFORE the LLM verifier: a patch that cannot even parse is wrong no
matter what a model says. Languages without a fast local checker return
None (unknown) and never block verification.
"""
import json
import os
import shutil
import subprocess
import sys

_TIMEOUT_S = 30


def _run(cmd: list):
    """(ok, stderr) from a checker command, or None when unavailable."""
    if shutil.which(cmd[0]) is None:
        return None
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=_TIMEOUT_S
        )
        return r.returncode == 0, (r.stderr or "").strip()[:300]
    except Exception:
        return None


def check_syntax(path: str):
    """Check one file's syntax.

    Returns {"ok": True} on a clean pass, {"ok": False, "message": str}
    on a hard failure, or None when no checker exists for this file type
    (unknown must never block a fix).
    """
    if not path or not os.path.exists(path):
        return None

    ext = os.path.splitext(path)[1].lower()

    if ext == ".py":
        r = _run([sys.executable, "-m", "py_compile", path])
        if r is None:
            return None
        return {"ok": r[0], "message": r[1] or None}

    if ext in (".js", ".mjs", ".cjs"):
        r = _run(["node", "--check", path])
        if r is None:
            return None
        return {"ok": r[0], "message": r[1] or None}

    if ext == ".json":
        try:
            with open(path, encoding="utf-8") as fh:
                json.load(fh)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "message": str(e)[:300]}

    # .ts/.tsx/.jsx and other languages have no fast, dependency-free
    # checker — leave them to the LLM verifier.
    return None
