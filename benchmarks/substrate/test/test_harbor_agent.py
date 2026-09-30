"""Harbor-facing calibration producer: every mode is scripted, model-free and credential-free."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "harbor"))

import harbor_agent  # noqa: E402
from harbor.agents.installed.base import ApiInternalServerError, ApiRateLimitError, ApiResponseStalledError  # noqa: E402
from harbor.models.agent.context import AgentContext  # noqa: E402


class FakeEnvironment:
    def __init__(self, fail_on: str | None = None) -> None:
        self.commands: list[str] = []
        self.fail_on = fail_on

    async def exec(self, command: str):
        self.commands.append(command)
        return SimpleNamespace(return_code=1 if self.fail_on and self.fail_on in command else 0)


def make(mode: str, tmp_path: Path) -> harbor_agent.CalibrationProducerAgent:
    return harbor_agent.CalibrationProducerAgent(logs_dir=tmp_path, mode=mode)


def run(agent, environment, context) -> None:
    asyncio.run(agent.run("instruction", environment, context))


def test_identity_is_stable_and_model_free(tmp_path: Path) -> None:
    agent = make("correct", tmp_path)
    assert agent.name() == "exharness-calibration-producer"
    assert agent.version() == "1.0.0"
    assert agent.model_name is None


def test_unknown_mode_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        make("call-a-model", tmp_path)


def test_modes_cover_the_calibration_matrix() -> None:
    assert set(harbor_agent.MODES) == {
        "correct", "wrong-artifact", "budget-stop-valid", "usage-known", "provider-timeout", "provider-rate-limit",
        "provider-5xx", "verifier-crash", "artifact-broken", "agent-timeout", "bootstrap-fail",
    }
    assert "calibrated" in harbor_agent.describe_modes() or harbor_agent.describe_modes().startswith("[")


@pytest.mark.parametrize(
    "mode,expected",
    [
        ("correct", "printf 'calibrated\\n' > /app/out/result.txt"),
        ("wrong-artifact", "printf 'wrong\\n' > /app/out/result.txt"),
        ("artifact-broken", "ln -s /nonexistent/result.txt /app/out/result.txt"),
    ],
)
def test_artifact_modes_write_only_the_declared_artifact(tmp_path: Path, mode: str, expected: str) -> None:
    environment = FakeEnvironment()
    context = AgentContext()
    run(make(mode, tmp_path), environment, context)
    assert environment.commands == ["mkdir -p /app/out", expected]
    assert context.metadata["producerStatus"] == "SUCCESS"
    assert context.metadata["termination"] == "COMPLETED"
    assert context.n_input_tokens is None and context.cost_usd is None, "no usage is invented"


def test_budget_stop_reports_termination_and_only_scripted_usage(tmp_path: Path) -> None:
    context = AgentContext()
    run(make("budget-stop-valid", tmp_path), FakeEnvironment(), context)
    assert context.metadata["termination"] == "BUDGET_EXHAUSTED"
    assert context.metadata["producerStatus"] == "BUDGET_STOP"
    assert (context.n_input_tokens, context.n_output_tokens) == (120, 30)
    assert context.n_cache_tokens is None and context.cost_usd is None


def test_usage_known_reports_every_scripted_field(tmp_path: Path) -> None:
    context = AgentContext()
    run(make("usage-known", tmp_path), FakeEnvironment(), context)
    assert (context.n_input_tokens, context.n_cache_tokens, context.n_output_tokens, context.cost_usd) == (100, 0, 20, 0.0)


@pytest.mark.parametrize(
    "mode,error",
    [("provider-timeout", ApiResponseStalledError), ("provider-rate-limit", ApiRateLimitError), ("provider-5xx", ApiInternalServerError)],
)
def test_provider_modes_raise_the_harbor_provider_exception_without_an_artifact(tmp_path: Path, mode: str, error: type) -> None:
    environment = FakeEnvironment()
    with pytest.raises(error):
        run(make(mode, tmp_path), environment, AgentContext())
    assert environment.commands == []


def test_verifier_crash_mode_writes_the_control_marker(tmp_path: Path) -> None:
    environment = FakeEnvironment()
    run(make("verifier-crash", tmp_path), environment, AgentContext())
    assert environment.commands[-1] == "mkdir -p /app/control && touch /app/control/crash-verifier"


def test_bootstrap_fail_raises_during_setup(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="bootstrap"):
        asyncio.run(make("bootstrap-fail", tmp_path).setup(FakeEnvironment()))
    asyncio.run(make("correct", tmp_path).setup(FakeEnvironment()))


def test_failed_environment_command_is_a_producer_error(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="producer command failed"):
        run(make("correct", tmp_path), FakeEnvironment(fail_on="printf"), AgentContext())


def test_agent_timeout_mode_sleeps_until_harbor_kills_it(tmp_path: Path, monkeypatch) -> None:
    slept: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    monkeypatch.setattr(harbor_agent.asyncio, "sleep", fake_sleep)
    with pytest.raises(RuntimeError, match="agent timeout"):
        run(make("agent-timeout", tmp_path), FakeEnvironment(), AgentContext())
    assert slept == [3600]


def test_module_has_no_model_or_provider_client_import() -> None:
    source = (Path(__file__).resolve().parents[1] / "harbor" / "harbor_agent.py").read_text()
    for forbidden in ("openai", "anthropic", "litellm", "google.genai", "API_KEY"):
        assert forbidden not in source
