"""
Simple security pipeline: redacts likely PII and flags likely prompt-
injection attempts in text before it's sent to the AI. Applied uniformly
at the single shared entry point (chat_with_retry), so every AI call in
the app is covered without touching each call site individually.
"""
import re

EMAIL_PATTERN = re.compile(r'\b[\w.+-]+@[\w-]+\.[\w.-]+\b')
PHONE_PATTERN = re.compile(r'(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}')
API_KEY_PATTERN = re.compile(r'\b(sk|pk|ghp|gho|AKIA|AIza)[a-zA-Z0-9_-]{16,}\b')

INJECTION_PATTERNS = [
    re.compile(r'ignore (all )?previous instructions', re.IGNORECASE),
    re.compile(r'disregard (the )?(system|above) prompt', re.IGNORECASE),
    re.compile(r'you are now', re.IGNORECASE),
    re.compile(r'new instructions?:', re.IGNORECASE),
    re.compile(r'\bsystem\s*:\s*override', re.IGNORECASE),
]


def redact_pii(text: str) -> str:
    if not text:
        return text
    text = EMAIL_PATTERN.sub("[REDACTED_EMAIL]", text)
    text = API_KEY_PATTERN.sub("[REDACTED_KEY]", text)
    text = PHONE_PATTERN.sub("[REDACTED_PHONE]", text)
    return text


def detect_prompt_injection(text: str) -> bool:
    if not text:
        return False
    return any(p.search(text) for p in INJECTION_PATTERNS)