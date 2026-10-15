"""
Evaluation analysis for the KOVR research questions.

Reads the production database (read-only) and reports:
  RQ1  Fix correctness — first-attempt vs. after-retry verification pass rate,
       attempt distribution, eventual resolution rate
  RQ1b Failure classes — bucketed from last_verify_reason
  RQ2  Verifier reliability — deterministic (syntax gate) vs. AI-verifier
       failure split
  RQ3  Detection consistency — score / finding stability across repeated
       scans of the same repository

Usage (from kovr-backend, with the production DATABASE_URL in .env):
    uv run python scripts/evaluate.py
Writes: evaluation_results.md next to the script.
"""
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(override=True)

from sqlalchemy import create_engine, text
from app.core.database import DATABASE_URL

FAILURE_BUCKETS = [
    ("syntax_gate", ["fails to compile", "syntax"]),
    ("repeat_patch", ["identical to a previous failed attempt"]),
    ("still_present", ["still appears", "still detected", "not resolved", "still present"]),
    ("ai_limit", ["quota", "limit reached", "ai limit"]),
    ("apply_error", ["working copy", "no longer on the server", "original file not found"]),
]


def bucket_reason(reason: str | None) -> str:
    if not reason:
        return "unknown"
    lower = reason.lower()
    for name, markers in FAILURE_BUCKETS:
        if any(m in lower for m in markers):
            return name
    return "verifier_rejected"


def pct(n: int, d: int) -> str:
    return f"{(100 * n / d):.1f}%" if d else "n/a"


def main() -> None:
    engine = create_engine(DATABASE_URL, connect_args={"options": "-csearch_path=public,extensions"})
    lines: list[str] = []
    out = lines.append

    out("# KOVR — Evaluation Results")
    with engine.connect() as conn:
        findings = conn.execute(
            text(
                "SELECT f.scan_id, f.pillar, f.severity, f.verified, "
                "f.fix_attempts, f.first_attempt_verified, f.last_verify_reason, "
                "s.repo_url, s.score FROM findings f "
                "LEFT JOIN scans s ON s.id = f.scan_id "
                "WHERE f.verified != 'superseded'"
            )
        ).fetchall()

        # ---- RQ1: fix correctness ------------------------------------------
        verified = [f for f in findings if f.verified in ("resolved", "failed")]
        loop = [f for f in verified if f.fix_attempts is not None]
        resolved = [f for f in loop if f.verified == "resolved"]
        first_pass = [f for f in loop if f.first_attempt_verified == "pass"]
        after_retry = [f for f in resolved if f.first_attempt_verified != "pass"]

        out("## RQ1 — Fix correctness (verified-fix loop)")
        out("")
        out(f"- Findings put through the fix loop: **{len(loop)}**")
        out(f"- First attempt passed verification: **{len(first_pass)} ({pct(len(first_pass), len(loop))})**")
        out(f"- Resolved only after feedback retries: **{len(after_retry)} ({pct(len(after_retry), len(loop))})**")
        out(f"- Never resolved (manual review): **{len(loop) - len(resolved)} ({pct(len(loop) - len(resolved), len(loop))})**")
        out(f"- Overall eventual resolution rate: **{pct(len(resolved), len(loop))}**")
        out("")
        dist = Counter(f.fix_attempts for f in loop)
        out("| Attempts used | Findings |")
        out("|---|---|")
        for k in sorted(dist):
            out(f"| {k} | {dist[k]} |")
        out("")

        # ---- RQ1b: failure classes ------------------------------------------
        out("## Failure classes (loop failures, bucketed)")
        out("")
        fails = [f for f in loop if f.verified == "failed"]
        buckets = Counter(bucket_reason(f.last_verify_reason) for f in fails)
        out("| Class | Count | Share |")
        out("|---|---|---|")
        for name, count in buckets.most_common():
            out(f"| {name} | {count} | {pct(count, len(fails))} |")
        out("")

        # ---- RQ2: verifier reliability --------------------------------------
        syntax_fails = sum(1 for f in fails if bucket_reason(f.last_verify_reason) == "syntax_gate")
        out("## RQ2 — Deterministic gate vs. AI verifier")
        out("")
        out(f"- Failures caught by the deterministic syntax gate: **{syntax_fails} ({pct(syntax_fails, len(fails))})**")
        out(f"- Failures judged by the AI verifier (passed syntax, rejected fix): "
            f"**{len(fails) - syntax_fails} ({pct(len(fails) - syntax_fails, len(fails))})**")
        out("")

        # ---- RQ3: detection consistency --------------------------------------
        out("## RQ3 — Detection consistency across repeated scans")
        out("")
        by_repo = defaultdict(list)
        for f in findings:
            if f.repo_url:
                by_repo[f.repo_url].append(f)
        for repo, rows in sorted(by_repo.items()):
            scan_ids = sorted({r.scan_id for r in rows})
            scores = {}
            for sid in scan_ids:
                for r in rows:
                    if r.scan_id == sid:
                        scores[sid] = None  # score comes from scans table below
            score_rows = conn.execute(
                text("SELECT id, score FROM scans WHERE repo_url = :u ORDER BY created_at"),
                {"u": repo},
            ).fetchall()
            if len(score_rows) < 2:
                continue
            out(f"**{repo}** — {len(score_rows)} scans")
            out("")
            out("| Scan | Score | Findings |")
            out("|---|---|---|")
            counts = Counter(r.scan_id for r in rows)
            for sid, score in score_rows:
                out(f"| {sid[:8]} | {score} | {counts.get(sid, 0)} |")
            vals = [s for _sid, s in score_rows if s is not None]
            if len(vals) > 1:
                spread = max(vals) - min(vals)
                out("")
                out(f"- Score spread across scans: **{spread} points** (max {max(vals)}, min {min(vals)})")
                pairs = []
                titles = {}
                for r in rows:
                    titles.setdefault(r.scan_id, set()).add((r.pillar, r.title))
                sids = [sid for sid, _s in score_rows]
                for i in range(len(sids)):
                    for j in range(i + 1, len(sids)):
                        a, b = titles.get(sids[i], set()), titles.get(sids[j], set())
                        union = a | b
                        pairs.append(len(a & b) / len(union) if union else 1.0)
                out(f"- Mean finding overlap (Jaccard) between scan pairs: "
                    f"**{sum(pairs) / len(pairs):.2f}** (1.00 = identical)")
            out("")

    report = "\n".join(lines)
    print(report)
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), "evaluation_results.md")
    with open(target, "w", encoding="utf-8") as fh:
        fh.write(report + "\n")
    print(f"\n[saved] {target}")


if __name__ == "__main__":
    main()
