"""Single LLM wrapper: retry, timeout, token/cost logging, mock + record/replay fixtures."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from dataclasses import asdict, dataclass

from app.config import settings
from app.observability import LLM_CALLS, LLM_COST, LLM_ERRORS, LLM_LATENCY, LLM_TOKENS

log = logging.getLogger("maw.llm")

DEFAULT_STEPS = [
    {"id": "s1", "title": "Plan the work", "agent": "planner"},
    {"id": "s2", "title": "Inspect the workspace", "agent": "coding"},
    {"id": "s3", "title": "Implement the change", "agent": "coding"},
    {"id": "s4", "title": "Verify with tests", "agent": "testing"},
]


@dataclass
class LLMResult:
    text: str
    model: str
    purpose: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    cached: bool = False
    latency_ms: float = 0.0


_FIXTURES: dict[str, str] = {}
_LOG: list[dict] = []


class LLMError(Exception):
    pass


def llm_log() -> list[dict]:
    return list(_LOG)


def reset_llm() -> None:
    _LOG.clear()
    _FIXTURES.clear()


def record_fixture(purpose: str, prompt: str, text: str) -> None:
    _FIXTURES[_cache_key(purpose, prompt)] = text


def _cache_key(purpose: str, prompt: str) -> str:
    return hashlib.sha256(f"{purpose}\n{prompt}".encode()).hexdigest()


def _mock_plan(prompt: str) -> str:
    steer = ""
    if "STEER:" in prompt:
        steer = prompt.split("STEER:", 1)[1].strip().splitlines()[0].strip()
    steps = [dict(step) for step in DEFAULT_STEPS]
    if steer:
        steps.insert(
            1,
            {"id": "s-steer", "title": f"Follow steer: {steer[:120]}", "agent": "coding"},
        )
    return json.dumps({"steps": steps, "summary": "Drafted a shared plan."})


MOCK_PLACEHOLDER = (
    "# Placeholder from the scripted demo agent: no AI key is configured, so no real code was generated.\n"
    "# Set GEMINI_API_KEY, XAI_API_KEY or OPENAI_API_KEY in the project-root .env and ask again.\n"
)


def mock_complete(purpose: str, prompt: str) -> str:
    if purpose in {"plan", "steer"}:
        return _mock_plan(prompt)
    if purpose == "coding":
        return json.dumps(
            {"files": [{"path": "src/agent_change.py", "content": MOCK_PLACEHOLDER}], "summary": "placeholder"}
        )
    if purpose == "handoff_summary":
        return "Context: the current plan is in progress. Remaining work is the next unchecked step. No pending approval."
    return "Acknowledged."


@dataclass(frozen=True)
class Provider:
    name: str
    api_key: str
    model: str
    url: str
    # USD per 1M tokens (prompt, completion); 0 when we do not track a price.
    rates: tuple[float, float] = (0.0, 0.0)


_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "xai": "https://api.x.ai/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
}


def _provider_config(name: str) -> Provider:
    base = (settings.llm_base_url or _BASE_URLS[name]).rstrip("/")
    url = f"{base}/chat/completions"
    if name == "xai":
        return Provider("xai", settings.xai_api_key, settings.xai_model, url)
    if name == "gemini":
        return Provider("gemini", settings.gemini_api_key, settings.gemini_model, url)
    return Provider("openai", settings.openai_api_key, settings.openai_model, url, (0.15, 0.6))


def active_provider() -> Provider | None:
    """Explicit LLM_PROVIDER wins; auto picks the first provider with a key."""
    choice = (settings.llm_provider or "auto").lower()
    if choice in _BASE_URLS:
        provider = _provider_config(choice)
        return provider if provider.api_key else None
    for name in ("openai", "xai", "gemini"):
        provider = _provider_config(name)
        if provider.api_key:
            return provider
    return None


def _use_mock() -> bool:
    mode = (settings.llm_mode or "auto").lower()
    if mode == "mock":
        return True
    if mode in {"live", "openai"}:
        return False
    return active_provider() is None


def is_mock() -> bool:
    return _use_mock()


RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}
OVERLOADED_STATUS = {429, 503}


def _http_status(exc: Exception | None) -> int | None:
    response = getattr(exc, "response", None)
    return getattr(response, "status_code", None)


def _fallback_model(provider: Provider) -> str:
    if settings.llm_fallback_model:
        return settings.llm_fallback_model
    return settings.gemini_fallback_model if provider.name == "gemini" else ""


async def _live_complete(prompt: str, timeout: float, model: str | None = None) -> LLMResult:
    import httpx

    provider = active_provider()
    if provider is None:
        raise LLMError("LLM_MODE=live but no OPENAI_API_KEY, XAI_API_KEY, or GEMINI_API_KEY is set")
    model = model or provider.model
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.post(
            provider.url,
            headers={"Authorization": f"Bearer {provider.api_key}"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        res.raise_for_status()
        data = res.json()
    text = data["choices"][0]["message"]["content"]
    usage = data.get("usage") or {}
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    prompt_rate, completion_rate = provider.rates
    cost = (prompt_tokens * prompt_rate + completion_tokens * completion_rate) / 1_000_000
    return LLMResult(
        text=text,
        model=f"{provider.name}:{model}",
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=round(cost, 6),
    )


def _record_metrics(result: LLMResult) -> None:
    LLM_CALLS.labels(result.model, result.purpose).inc()
    LLM_TOKENS.labels(result.model, "prompt").inc(result.prompt_tokens)
    LLM_TOKENS.labels(result.model, "completion").inc(result.completion_tokens)
    LLM_COST.labels(result.model).inc(result.cost_usd)
    LLM_LATENCY.labels(result.model).observe(result.latency_ms / 1000)


async def complete(prompt: str, *, purpose: str = "generic", timeout: float | None = None) -> LLMResult:
    timeout = settings.llm_timeout_seconds if timeout is None else timeout
    key = _cache_key(purpose, prompt)
    if key in _FIXTURES:
        result = LLMResult(text=_FIXTURES[key], model="fixture", purpose=purpose, cached=True)
        _LOG.append(asdict(result))
        return result

    last_exc: Exception | None = None
    started = time.perf_counter()
    attempts = max(1, int(settings.llm_retries or 1))
    model: str | None = None
    for attempt in range(1, attempts + 1):
        try:

            async def _call() -> LLMResult:
                if _use_mock():
                    text = mock_complete(purpose, prompt)
                    return LLMResult(
                        text=text,
                        model="mock",
                        purpose=purpose,
                        prompt_tokens=max(1, len(prompt) // 4),
                        completion_tokens=max(1, len(text) // 4),
                        cost_usd=0.0,
                    )
                result = await _live_complete(prompt, timeout, model)
                result.purpose = purpose
                return result

            result = await asyncio.wait_for(_call(), timeout=timeout)
            result.latency_ms = round((time.perf_counter() - started) * 1000, 1)
            _LOG.append(asdict(result))
            _record_metrics(result)
            log.info(
                "llm purpose=%s model=%s tokens=%s/%s cost=%s cached=%s",
                purpose,
                result.model,
                result.prompt_tokens,
                result.completion_tokens,
                result.cost_usd,
                result.cached,
                extra={
                    "purpose": purpose,
                    "model": result.model,
                    "prompt_tokens": result.prompt_tokens,
                    "completion_tokens": result.completion_tokens,
                    "cost_usd": result.cost_usd,
                    "latency_ms": result.latency_ms,
                },
            )
            return result
        except Exception as exc:
            last_exc = exc
            LLM_ERRORS.labels(purpose).inc()
            log.warning("llm attempt %s/%s failed: %s", attempt, attempts, _describe_error(exc, timeout))
            status = _http_status(exc)
            if status is not None and status not in RETRYABLE_STATUS:
                break  # bad key, unknown model, bad request: retrying cannot help
            if attempt == attempts:
                break
            provider = active_provider()
            if status in OVERLOADED_STATUS and provider and _fallback_model(provider):
                model = _fallback_model(provider)
            if status in RETRYABLE_STATUS:
                await asyncio.sleep(min(2.0**attempt, 8.0))
            else:
                await asyncio.sleep(0.05 * attempt)
    raise LLMError(_describe_error(last_exc, timeout) if last_exc else "LLM call failed")


def _describe_error(exc: Exception, timeout: float) -> str:
    if isinstance(exc, asyncio.TimeoutError):
        return f"no response within {timeout:g}s (raise LLM_TIMEOUT_SECONDS)"
    status = _http_status(exc)
    if status in OVERLOADED_STATUS:
        return f"the AI provider is overloaded or rate-limited (HTTP {status}); try again in a minute"
    if status in {401, 403}:
        return f"the AI provider rejected the API key (HTTP {status})"
    if status == 404:
        return "the AI provider does not offer this model (HTTP 404); change GEMINI_MODEL / XAI_MODEL / OPENAI_MODEL"
    return str(exc) or type(exc).__name__
