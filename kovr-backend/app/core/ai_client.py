import os
import json
import re
import time
import threading
from dotenv import load_dotenv
from groq import Groq, RateLimitError as GroqRateLimitError
from openai import OpenAI, RateLimitError as OpenAIRateLimitError  # OpenRouter/Gemini/Z.ai are OpenAI-compatible
from langsmith import traceable
from app.core.security_pipeline import redact_pii, detect_prompt_injection
from app.core.progress import is_scan_cancelled, is_scan_paused

load_dotenv(override=True)

# Both SDKs raise a provider-specific RateLimitError; the retry/cooldown
# logic below must catch either kind.
RATE_LIMIT_ERRORS = (GroqRateLimitError, OpenAIRateLimitError)

# Clients are built only when their key exists, so importing the app on a
# fresh machine (CI runner, new clone) never crashes — the chain simply
# contains whichever providers are configured.
groq_client = (
    Groq(api_key=os.getenv("GROQ_API_KEY"))
    if os.getenv("GROQ_API_KEY")
    else None
)
openrouter_client = (
    OpenAI(
        api_key=os.getenv("OPENROUTER_API_KEY"),
        base_url="https://openrouter.ai/api/v1",
    )
    if os.getenv("OPENROUTER_API_KEY")
    else None
)

# Gemini through Google's OpenAI-compatible endpoint — the same SDK is
# reused, so no extra dependency. Only created when a key is present; the
# chain entry below is skipped otherwise. AI Studio keys include a free
# tier, so Gemini stays as the last-resort fallback at no cost.
gemini_client = (
    OpenAI(
        api_key=os.getenv("GEMINI_API_KEY"),
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
    )
    if os.getenv("GEMINI_API_KEY")
    else None
)

# Provider chain, in priority order: (client, model, label).
# Groq first (fast), a second Groq model as in-provider fallback, then
# OpenRouter, Gemini 2.x Flash, and finally Z.ai GLM — each a genuinely
# different provider/infrastructure, so the chain keeps working even when
# the pools above it are exhausted.
PROVIDER_CHAIN = []
if groq_client:
    PROVIDER_CHAIN.append((groq_client, os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"), "groq"))
    PROVIDER_CHAIN.append(
        (groq_client, os.getenv("GROQ_FALLBACK_MODEL", "openai/gpt-oss-20b"), "groq")
    )
if openrouter_client:
    PROVIDER_CHAIN.append(
        (openrouter_client, os.getenv("OPENROUTER_MODEL", "openrouter/free"), "openrouter")
    )
if gemini_client:
    PROVIDER_CHAIN.append(
        (gemini_client, os.getenv("GEMINI_MODEL", "gemini-2.5-flash"), "gemini")
    )

MAX_RATE_LIMIT_RETRIES = 1

# Known-good model slugs per provider. Runtime chain edits validate against
# this list — a free-text model field is how you get silent 404s from
# deprecated slugs.
KNOWN_MODELS = {
    "groq": [
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "qwen/qwen3-32b",
        "moonshotai/kimi-k2-instruct",
    ],
    "openrouter": [
        "openai/gpt-oss-120b:free",
        "openai/gpt-oss-20b:free",
        "deepseek/deepseek-chat",
        "meta-llama/llama-3.3-70b-instruct:free",
        "qwen/qwen3-14b:free",
        "google/gemini-2.0-flash-exp:free",
    ],
    "gemini": [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
    ],
}

# The chain is a fallback ORDER, not a menu: requests walk it top-down and
# drop to the next pair on quota/rate-limit failure. It starts as the .env
# defaults and can be reordered/edited at runtime via /api/settings/models.
# In-memory only — a backend restart returns to the .env defaults.
_config_lock = threading.Lock()
_runtime_chain = list(PROVIDER_CHAIN)
_last_successful = {"label": None, "model": None}


def get_provider_chain():
    with _config_lock:
        return list(_runtime_chain)


def get_last_successful():
    with _config_lock:
        return dict(_last_successful)


def set_provider_chain(chain):
    """Install a new fallback chain of (client, model, label) tuples."""
    global _runtime_chain
    with _config_lock:
        _runtime_chain = list(chain)


# Circuit breaker: when a pair exhausts its rate-limit retries it enters a
# cooldown window during which every request skips straight to the next
# fallback. Without this, N parallel findings each burn ~30s re-discovering
# that the same dead model is still dead — the exact log spam the chain
# exists to avoid.
_cooldown_until: dict[str, float] = {}
COOLDOWN_RATE_LIMIT_S = 120.0  # survived its retry — sit out two minutes
COOLDOWN_QUOTA_S = 3600.0      # daily quota — nothing changes for hours


def _pair_key(label: str, model: str) -> str:
    return f"{label}/{model}"


def _cooldown_remaining(key: str) -> float:
    with _config_lock:
        return max(0.0, _cooldown_until.get(key, 0.0) - time.time())


def _mark_cooldown(key: str, seconds: float) -> None:
    with _config_lock:
        _cooldown_until[key] = time.time() + seconds


def get_active_cooldowns() -> dict[str, float]:
    """label/model -> seconds remaining, surfaced in admin model settings."""
    now = time.time()
    with _config_lock:
        return {k: max(0.0, v - now) for k, v in _cooldown_until.items() if v > now}


class ScanCancelledError(RuntimeError):
    """Raised inside AI work when the user cancels the scan. Cooperative —
    caught by the pillar runner, which marks the pillar cancelled."""


# Which scan (and pillar) the CURRENT thread is working on, so the deep AI
# call path can react to cancel/pause without threading scan ids through
# every scanner signature.
_scan_context = threading.local()

# A paused scan holds its slot; 15 minutes is long enough to wait out a
# rate-limit window without parking a thread forever.
MAX_PAUSE_SECONDS = 900

# One AI call must never wedge a scan: free-tier providers sometimes hang
# instead of erroring, and the whole chain stalls behind them.
AI_REQUEST_TIMEOUT_S = 120


def set_current_scan(scan_id, pillar=None):
    _scan_context.scan_id = scan_id
    _scan_context.pillar = pillar


def get_current_scan():
    return getattr(_scan_context, "scan_id", None), getattr(_scan_context, "pillar", None)


def _check_scan_cancelled():
    scan_id = getattr(_scan_context, "scan_id", None)
    if scan_id and is_scan_cancelled(scan_id):
        raise ScanCancelledError(f"scan {scan_id} cancelled by user")


def _wait_while_paused():
    scan_id = getattr(_scan_context, "scan_id", None)
    if not scan_id:
        return
    waited = 0.0
    while is_scan_paused(scan_id) and waited < MAX_PAUSE_SECONDS:
        _check_scan_cancelled()
        time.sleep(1.0)
        waited += 1.0


def _retry_seconds_from_error(message: str) -> float:
    """Groq 429 messages contain 'Please try again in 8.44s' — parse it."""
    match = re.search(r"try again in ([\d.]+)s", message)
    return float(match.group(1)) if match else 15.0


def _create(client, model: str, messages: list, max_tokens: int, temperature: float):
    return client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
        timeout=AI_REQUEST_TIMEOUT_S,
    )

@traceable(name="chat_with_retry", run_type="llm")
def chat_with_retry(messages: list, max_tokens: int, temperature: float):
    """
    One chat completion that walks the provider chain:

      Groq (primary) -> Groq (fallback) -> OpenRouter -> Gemini 2.x Flash

    Each provider+model pair gets up to MAX_RATE_LIMIT_RETRIES attempts
    against transient per-minute limits. A pair that still hits a limit is
    placed in a cooldown so subsequent requests skip it entirely and land
    on the next healthy fallback instead of re-waiting on a dead one.
    """
    # Simple security pass: redact obvious PII, flag likely prompt
    # injection, before any request leaves the app. Applied here since
    # every AI call in KOVR funnels through this one function.
    safe_messages = []
    for m in messages:
        content = m.get("content", "")
        if detect_prompt_injection(content):
            print(f"[security] possible prompt injection detected in outgoing message")
        safe_messages.append({**m, "content": redact_pii(content)})
    messages = safe_messages

    last_error = None

    if not get_provider_chain():
        raise RuntimeError(
            "No AI provider configured — set at least one of "
            "GROQ_API_KEY, OPENROUTER_API_KEY or GEMINI_API_KEY."
        )

    # Cancel/pause react at every AI-call boundary — the only genuinely
    # slow step in a scan, so this is where user control must land.
    _check_scan_cancelled()
    _wait_while_paused()

    # Walk order: the pair that served the last successful request goes
    # first — once the primary pool is dead for the day, requests land
    # straight on the fallback that is still alive.
    chain = get_provider_chain()
    last = get_last_successful()
    if last.get("label") and last.get("model"):
        pair = next(
            (p for p in chain if p[2] == last["label"] and p[1] == last["model"]),
            None,
        )
        if pair:
            chain = [pair] + [p for p in chain if p is not pair]

    available: list = []
    skipped: list = []
    for p in chain:
        remaining = _cooldown_remaining(_pair_key(p[2], p[1]))
        if remaining > 0:
            skipped.append((p, remaining))
        else:
            available.append(p)
    for (client, model, label), remaining in skipped:
        print(f"[ai] {label}/{model} in cooldown ({remaining:.0f}s left) — skipping")

    if not available and skipped:
        # Every pair is cooling down. Force the soonest-expiring one so the
        # request still gets a real attempt (re-arming the cooldown if the
        # limit is still in force) instead of failing instantly.
        skipped.sort(key=lambda item: item[1])
        available = [skipped[0][0]]

    for client, model, label in available:
        key = _pair_key(label, model)
        for attempt in range(MAX_RATE_LIMIT_RETRIES):
            _check_scan_cancelled()
            _wait_while_paused()
            try:
                response = _create(client, model, messages, max_tokens, temperature)
                with _config_lock:
                    _last_successful["label"] = label
                    _last_successful["model"] = model
                    _cooldown_until.pop(key, None)
                return response
            except RATE_LIMIT_ERRORS as e:
                message = str(e)
                lower = message.lower()
                if (
                    "tokens per day" in message
                    or "quota" in lower
                    or "insufficient balance" in lower
                    or "resource package" in lower
                ):
                    _mark_cooldown(key, COOLDOWN_QUOTA_S)
                    print(f"[ai] {label}/{model}: daily quota exhausted — "
                          f"cooling down {COOLDOWN_QUOTA_S / 60:.0f}m, switching")
                    last_error = e
                    break
                wait = _retry_seconds_from_error(message) + 1.0
                print(f"[ai] {label}/{model} rate limited; "
                      f"retry {attempt + 1}/{MAX_RATE_LIMIT_RETRIES} in {wait:.1f}s")
                # Sleep in slices so pause holds and cancel lands mid-wait.
                remaining = wait
                while remaining > 0:
                    _check_scan_cancelled()
                    _wait_while_paused()
                    time.sleep(min(1.0, remaining))
                    remaining -= min(1.0, remaining)
                last_error = e
            except Exception as e:
                print(f"[ai] {label}/{model} failed ({e}); switching")
                last_error = e
                break
        else:
            _mark_cooldown(key, COOLDOWN_RATE_LIMIT_S)
            print(f"[ai] {label}/{model}: retries exhausted — "
                  f"cooling down {COOLDOWN_RATE_LIMIT_S / 60:.0f}m, switching")

    raise last_error

def clean_model_output(raw_text: str) -> str:
    """
    Normalize a model answer to bare JSON text. Reasoning models such as
    Qwen3 wrap output in <think>...</think> blocks (sometimes unclosed when
    truncated); strip those first, then markdown code fences. Some
    providers also return content: null — treated as empty text.
    """
    cleaned = (raw_text or "").strip()
    cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.DOTALL).strip()
    # Truncated thinking: an opened but never closed block leaves no JSON.
    if "<think>" in cleaned:
        cleaned = cleaned.split("<think>", 1)[0].strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
    return cleaned


MAX_FIX_GENERATION_ATTEMPTS = 4


def _strip_noise(code: str) -> str:
    """Remove comments and blank/whitespace-only lines so a no-op
    "fix" (adding only a comment) doesn't pass as a real code change."""
    lines = []
    for line in code.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith(("//", "#", "/*", "*")):
            continue
        lines.append(stripped)
    return "\n".join(lines)


def _brace_balance(code: str) -> int:
    return code.count("{") - code.count("}")


PLACEHOLDER_PATTERNS = [
    "todo:", "todo ", "existing logic", "existing asynchronous logic",
    "add the original", "implement logic", "your logic here",
    "// ...", "/* ... */", "database queries) goes here",
]


def _has_placeholder(code: str) -> bool:
    lower = code.lower()
    return any(p in lower for p in PLACEHOLDER_PATTERNS)


def has_real_patch(parsed: dict) -> bool:
    before = (parsed.get("before_code") or "").strip()
    after = (parsed.get("after_code") or "").strip()
    if not before or not after:
        return False
    if _strip_noise(before) == _strip_noise(after):
        return False
    before_balance = _brace_balance(before)
    after_balance = _brace_balance(after)
    if abs(after_balance - before_balance) > 1:
        return False
    # A fix that introduces a placeholder comment instead of real code is
    # never acceptable — reject and force a retry with a stricter prompt.
    if _has_placeholder(after) and not _has_placeholder(before):
        return False
    return True

@traceable(name="investigate_finding", run_type="chain")
def investigate_finding(finding: dict, code_snippet: str = "", previous_failure_reason: str = None, previous_after_code: str = None):
    failure_note = ""
    if previous_failure_reason:
        previous_attempt_block = ""
        if previous_after_code:
            previous_attempt_block = f"""

Your previous attempted fix was:
{previous_after_code}

Do not repeat this same fix. If it used a placeholder instead of real code, or left real logic outside the fix, correct that specifically this time."""

        failure_note = f"""

A previous automatic fix attempt for this exact issue was applied but did NOT resolve it. The verification reason was:
"{previous_failure_reason}"{previous_attempt_block}

This likely means the previous fix targeted the wrong location, or made only a superficial change (e.g. a comment or placeholder) instead of the actual required code change. Look carefully at the code context below and identify the REAL location where the fix must happen — it may be a different function than the one shown, if the description implies related but separate logic (e.g. a "failure" or "error" path when only a "success" path is shown). If the needed fix is in a function not shown in the code context, describe this clearly in fix_explanation and still return your best concrete before_code/after_code targeting whatever relevant code IS shown."""

    base_prompt = f"""You are a security engineer AI. Analyze this finding and respond ONLY in JSON, no preamble, no markdown fences.

Finding:
- Tool: {finding.get('tool')}
- Title: {finding.get('title')}
- File: {finding.get('file')}
- Line: {finding.get('line')}
- Description: {finding.get('description')}{failure_note}

Actual code context:
{code_snippet}

If a "Referenced implementation" section appears above, it is for your understanding only. The file that will actually be patched is the CURRENT file's code shown before that section — before_code and after_code must only contain code from the current file's section, never from the referenced implementation.

Always attempt a concrete before_code/after_code fix, even a partial or conservative one. Only leave them blank if the issue truly cannot be fixed in this file (e.g. it requires rotating a credential value outside the codebase). If you cannot produce a fix, explain exactly why in fix_explanation instead of leaving it blank.

CRITICAL RULE: after_code must preserve EVERY line of existing logic from before_code, unchanged, except for the specific lines needed to fix this issue. NEVER replace real code with a placeholder comment such as "// TODO: implement logic", "// existing logic here", or similar — this is a severe error. If the fix requires wrapping existing code in a try/catch, error boundary, or similar structure, you MUST move the ACTUAL existing statements (the real variable declarations, function calls, and return statements exactly as they appear in the code context) inside that structure — not a comment describing what they do. Before finalizing after_code, verify every real statement present in before_code (excluding only what you are deliberately removing as the fix) is still present in after_code.

If this issue is about a pattern or convention that appears multiple times in the code context shown above (e.g. multiple functions with inconsistent naming, multiple places missing the same check), your fix MUST address every occurrence visible in the code context, not just the first one. A fix that corrects only one instance while leaving other visible instances of the same problem unchanged will fail verification and is not acceptable.

ATTRIBUTE RULE: when the fix adds an attribute, prop, or argument (for example aria-label, alt, title, type, or options), after_code MUST show the actual element/component WITH that attribute applied to it — e.g. <Image aria-label={{imageIconAltText}} />. Defining a variable or constant WITHOUT attaching it to the element is NOT a fix and will fail verification. If the element itself is not visible in any code context provided, say so in fix_explanation and still attach the attribute wherever that element appears in the provided context.

WRAPPER RULE: when the fix wraps an existing function or call in error handling (try/catch, .catch(), a wrapper function), after_code MUST still execute the original logic — a wrapper that renames the original but never calls it, or a try/catch that omits the original statements, is a broken fix and will fail verification. Every operation the code performed before the fix must still be performed after it.

COORDINATION RULE: every variable referenced in after_code must already exist in before_code, be declared inside after_code, or exist at module level in this file. When a fix needs a value produced earlier in the function (for example, the public_id of an upload, a connection handle, a created record), you MUST add the capturing assignment at the production site in the SAME patch (e.g. const result = await upload(...); const uploadedId = result.public_id;) and then reference it in the cleanup/error handling. Referencing a name that is never assigned anywhere fixes nothing and will fail verification.

If an "ADDITIONAL CONTEXT" section appears below the main code context, it contains the real occurrence of the element this finding is about, from elsewhere in the SAME file. before_code/after_code may be taken from either section — both are the current file's real code, copied verbatim.

Respond with this exact JSON structure:
{{
  "root_cause": "...",
  "impact": "...",
  "attack_path": "...",
  "fix_explanation": "short plain-English explanation of the fix",
  "before_code": "the ENTIRE function containing the issue, copied EXACTLY verbatim from the code context above, including the def line and all body lines",
  "after_code": "the complete corrected version of that same function"
}}

Important: before_code must match the code context above character-for-character, including exact whitespace/indentation, so it can be used for a direct text replacement of the whole function."""

    last_parsed = None
    last_raw = ""

    for attempt in range(MAX_FIX_GENERATION_ATTEMPTS):
        prompt = base_prompt
        if attempt > 0:
            prompt += "\n\nIMPORTANT: Your previous attempt did not include a usable before_code/after_code fix. Try again — produce a real, concrete code change this time, even if conservative."

        response = chat_with_retry(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000,
            temperature=0.1
        )

        raw_text = response.choices[0].message.content
        cleaned = clean_model_output(raw_text)
        last_raw = raw_text

        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            parsed = None

        if parsed:
            last_parsed = parsed
            if has_real_patch(parsed):
                return parsed

    # Every attempt failed to produce a real patch — never return blank code.
    # Fall back to showing the current code as both before/after so the UI
    # always has something concrete to display, flagged for manual review.
    fallback = last_parsed or {
        "root_cause": None,
        "impact": None,
        "attack_path": None,
        "fix_explanation": None,
    }
    fallback["before_code"] = (fallback.get("before_code") or "").strip() or code_snippet
    fallback["after_code"] = (fallback.get("after_code") or "").strip() or code_snippet
    fallback["fix_explanation"] = (
        (fallback.get("fix_explanation") or "").strip()
        or "An automatic fix could not be generated after multiple attempts. Showing the current code — review and edit manually."
    )
    fallback["parse_error"] = False
    fallback["auto_fix_unavailable"] = True
    fallback["raw"] = last_raw
    return fallback
MAX_VERIFY_CODE_CHARS = 3000


@traceable(name="verify_finding", run_type="chain")
def check_finding_resolved(
    title: str,
    description: str,
    before_code: str,
    fixed_code: str,
    after_code: str = "",
    file_context: str = "",
):
    # Verifying only needs enough code to judge the specific issue, not the
    # entire file. Crucially, the snippet must contain the PATCHED region:
    # truncating to the file head hides fixes deeper in the file and
    # produces false "still detected" verdicts. file_context (a window
    # centered on where the patch landed) takes priority.
    before_snippet = (before_code or "")[:MAX_VERIFY_CODE_CHARS]
    source_snippet = (file_context or fixed_code or "")[:MAX_VERIFY_CODE_CHARS]
    after_snippet = (after_code or "")[:1500]

    prompt = f"""You are verifying whether a specific code issue has been resolved.

Original issue: {title}
Description: {description}

Original code (had the issue):
{before_snippet}

Applied patch (what the fix changed):
{after_snippet}

Current code, centered on where the patch landed:
{source_snippet}

Question: Does the applied patch resolve this SPECIFIC issue in the component it changed? Judge ONLY that component — the same pattern may legitimately remain in other components of the file; those are separate findings, not a failure of this fix.

Respond ONLY with JSON, no preamble, no markdown fences:
{{"resolved": true or false, "reason": "one sentence explanation"}}"""

    try:
        response = chat_with_retry(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=600,
            temperature=0.1
        )
    except Exception as e:
        return {"resolved": None, "reason": f"Verification could not run: {e}", "verify_error": True}

    raw_text = response.choices[0].message.content
    if not raw_text or not raw_text.strip():
        return {"resolved": None, "reason": "AI returned an empty response during verification", "verify_error": True}

    try:
        return json.loads(clean_model_output(raw_text))
    except json.JSONDecodeError:
        
        # Retry once with a stricter instruction before giving up — same
        # pattern used for fix-generation parse failures.
        retry_prompt = prompt + "\n\nIMPORTANT: Your previous response was not valid JSON. Respond with ONLY the JSON object, nothing else."
        try:
            retry_response = chat_with_retry(
                messages=[{"role": "user", "content": retry_prompt}],
                max_tokens=400,
                temperature=0.1
            )
            retry_raw = retry_response.choices[0].message.content
            return json.loads(clean_model_output(retry_raw))
        except Exception as e:
            return {"resolved": None, "reason": f"Could not parse verification response after retry: {e}", "verify_error": True}