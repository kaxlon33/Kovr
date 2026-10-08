# Simple in-memory storage (resets when server restarts)
scans = {}       # scan_id -> list of findings
findings = {}    # finding_id -> single finding dict