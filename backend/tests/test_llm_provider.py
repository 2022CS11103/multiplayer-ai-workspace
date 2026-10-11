import httpx
import pytest

import app.llm as llm
from app.config import settings
from app.llm import _use_mock, active_provider


@pytest.fixture
def llm_settings():
    keys = ("openai_api_key", "xai_api_key", "gemini_api_key", "llm_provider", "llm_mode", "llm_base_url")
    saved = {key: getattr(settings, key) for key in keys}
    settings.openai_api_key = ""
    settings.xai_api_key = ""
    settings.gemini_api_key = ""
    settings.llm_provider = "auto"
    settings.llm_mode = "auto"
    settings.llm_base_url = ""
    yield settings
    for key, value in saved.items():
        setattr(settings, key, value)


def test_no_key_is_mock(llm_settings):
    assert active_provider() is None
    assert _use_mock() is True


def test_auto_picks_grok(llm_settings):
    llm_settings.xai_api_key = "xai-test"
    provider = active_provider()
    assert provider.name == "xai"
    assert provider.url == "https://api.x.ai/v1/chat/completions"
    assert _use_mock() is False


def test_auto_picks_gemini(llm_settings):
    llm_settings.gemini_api_key = "gemini-test"
    provider = active_provider()
    assert provider.name == "gemini"
    assert provider.url == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"


def test_explicit_provider_wins(llm_settings):
    llm_settings.xai_api_key = "xai-test"
    llm_settings.gemini_api_key = "gemini-test"
    llm_settings.llm_provider = "gemini"
    assert active_provider().name == "gemini"


def test_mock_mode_ignores_keys(llm_settings):
    llm_settings.xai_api_key = "xai-test"
    llm_settings.llm_mode = "mock"
    assert _use_mock() is True


def _http_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://example.invalid/chat/completions")
    return httpx.HTTPStatusError("boom", request=request, response=httpx.Response(status, request=request))


@pytest.fixture
def live_gemini(llm_settings, monkeypatch):
    llm_settings.gemini_api_key = "gemini-test"
    monkeypatch.setattr(llm, "asyncio", _FastSleep(llm.asyncio))
    return monkeypatch


class _FastSleep:
    """asyncio proxy whose sleep returns at once, so backoff does not slow the suite."""

    def __init__(self, real):
        self._real = real

    def __getattr__(self, name):
        return getattr(self._real, name)

    async def sleep(self, _seconds):
        return None


async def test_overloaded_model_falls_back(live_gemini):
    models = []

    async def fake(prompt, timeout, model=None):
        models.append(model)
        if model is None:
            raise _http_error(503)
        return llm.LLMResult(text="ok", model=f"gemini:{model}")

    live_gemini.setattr(llm, "_live_complete", fake)
    result = await llm.complete("hi", purpose="plan")
    assert models == [None, settings.gemini_fallback_model]
    assert result.model == f"gemini:{settings.gemini_fallback_model}"


async def test_bad_key_is_not_retried(live_gemini):
    calls = []

    async def fake(prompt, timeout, model=None):
        calls.append(model)
        raise _http_error(401)

    live_gemini.setattr(llm, "_live_complete", fake)
    with pytest.raises(llm.LLMError, match="rejected the API key"):
        await llm.complete("hi", purpose="plan")
    assert len(calls) == 1
