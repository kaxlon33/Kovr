import subprocess
import json
import os
import platform

def run_gitleaks(repo_path: str):
    result = subprocess.run(
    ["gitleaks", "detect", "--source", repo_path, "--report-format", "json", "--report-path", "gitleaks_report.json", "--no-git"],
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace"
    )
    try:
        with open("gitleaks_report.json", "r") as f:
            raw_findings = json.load(f)
    except FileNotFoundError:
        raw_findings = []

    findings = []
    for item in raw_findings:
        findings.append({
            "pillar": "security",
            "tool": "gitleaks",
            "title": "Leaked secret detected",
            "file": item.get("File"),
            "line": item.get("StartLine"),
            "severity": "high",
            "description": item.get("Description")
        })

    return findings

def run_semgrep(repo_path: str):
    if platform.system() == "Windows":
        # Local Windows dev only — Semgrep's native binary doesn't run on
        # Windows, so shell out through WSL. In Docker (Linux), this
        # branch is never used — semgrep runs directly.
        cmd = ["wsl", "-d", "Ubuntu", "bash", "-lc", f"semgrep --config=auto --json {repo_path}"]
    else:
        cmd = ["semgrep", "--config=auto", "--json", repo_path]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace"
    )
    try:
        raw_output = json.loads(result.stdout)
        raw_results = raw_output.get("results", [])
    except json.JSONDecodeError:
        raw_results = []

    findings = []
    for item in raw_results:
        findings.append({
            "pillar": "security",
            "tool": "semgrep",
            "title": item.get("check_id"),
            "file": item.get("path"),
            "line": item.get("start", {}).get("line"),
            "severity": item.get("extra", {}).get("severity", "medium").lower(),
            "description": item.get("extra", {}).get("message")
        })

    return findings
