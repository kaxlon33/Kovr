import math

def calculate_score(findings: list):
    weights = {
        "critical": 10,
        "high": 6,
        "error": 6,
        "medium": 3,
        "warning": 3,
        "low": 1,
        "info": 1
    }

    total_weight = 0
    for finding in findings:
        severity = (finding.get("severity") or "low").lower()
        total_weight += weights.get(severity, 1)

    # Diminishing-returns curve: even a very bad repo won't hit a hard 0
    # until findings are extremely severe/numerous, but still trends toward
    # low scores quickly for genuinely bad repos.
    score = 100 * math.exp(-total_weight / 60)
    return round(max(score, 1))