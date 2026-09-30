"""Harbor-facing, model-free calibration producer for the benchmark substrate.

This module is loaded only by Harbor (``-a harbor_agent:CalibrationProducerAgent``) inside the
substrate adapter's child process. ``packages/benchmark`` never imports it. Each mode is a
deterministic scripted producer used to exercise one row of the substrate calibration matrix;
no mode calls a model or needs a credential.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from harbor.agents.base import BaseAgent
from harbor.agents.installed.base import ApiInternalServerError, ApiRateLimitError, ApiResponseStalledError
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

EXPECTED = "calibrated"
ARTIFACT_DIR = "/app/out"
CONTROL_DIR = "/app/control"

# mode -> declared producer behaviour (what the producer itself reports; never quality).
MODES: dict[str, dict[str, Any]] = {
    "correct": {"artifact": "correct", "producerStatus": "SUCCESS", "termination": "COMPLETED"},
    "wrong-artifact": {"artifact": "wrong", "producerStatus": "SUCCESS", "termination": "COMPLETED"},
    "budget-stop-valid": {"artifact": "correct", "producerStatus": "BUDGET_STOP", "termination": "BUDGET_EXHAUSTED",
                          "usage": {"n_input_tokens": 120, "n_output_tokens": 30}},
    "usage-known": {"artifact": "correct", "producerStatus": "SUCCESS", "termination": "COMPLETED",
                    "usage": {"n_input_tokens": 100, "n_cache_tokens": 0, "n_output_tokens": 20, "cost_usd": 0.0}},
    "provider-timeout": {"artifact": None, "raise": "timeout"},
    "provider-rate-limit": {"artifact": None, "raise": "rate-limit"},
    "provider-5xx": {"artifact": None, "raise": "5xx"},
    "verifier-crash": {"artifact": "correct", "producerStatus": "SUCCESS", "termination": "COMPLETED", "control": "crash-verifier"},
    "artifact-broken": {"artifact": "symlink", "producerStatus": "SUCCESS", "termination": "COMPLETED"},
    "agent-timeout": {"artifact": None, "sleep": 3600},
    "bootstrap-fail": {"artifact": None, "setup_fail": True},
}

RAISES = {
    "timeout": ApiResponseStalledError,
    "rate-limit": ApiRateLimitError,
    "5xx": ApiInternalServerError,
}


def artifact_commands(kind: str | None) -> list[str]:
    if kind is None:
        return []
    commands = [f"mkdir -p {ARTIFACT_DIR}"]
    if kind == "correct":
        commands.append(f"printf '{EXPECTED}\\n' > {ARTIFACT_DIR}/result.txt")
    elif kind == "wrong":
        commands.append(f"printf 'wrong\\n' > {ARTIFACT_DIR}/result.txt")
    elif kind == "symlink":
        commands.append(f"ln -s /nonexistent/result.txt {ARTIFACT_DIR}/result.txt")
    else:
        raise ValueError(f"unknown artifact kind {kind}")
    return commands


class CalibrationProducerAgent(BaseAgent):
    def __init__(self, *args: Any, mode: str = "correct", **kwargs: Any) -> None:
        if mode not in MODES:
            raise ValueError(f"unknown calibration mode {mode!r}")
        self.mode = mode
        super().__init__(*args, **kwargs)

    @staticmethod
    def name() -> str:
        return "exharness-calibration-producer"

    def version(self) -> str:
        return "1.0.0"

    async def setup(self, environment: BaseEnvironment) -> None:
        if MODES[self.mode].get("setup_fail"):
            raise RuntimeError("calibration producer bootstrap failed (scripted)")

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        spec = MODES[self.mode]
        for command in artifact_commands(spec.get("artifact")):
            result = await environment.exec(command)
            if getattr(result, "return_code", 0) != 0:
                raise RuntimeError(f"producer command failed: {command}")
        if spec.get("control") == "crash-verifier":
            await environment.exec(f"mkdir -p {CONTROL_DIR} && touch {CONTROL_DIR}/crash-verifier")
        if "sleep" in spec:
            await asyncio.sleep(spec["sleep"])
            raise RuntimeError("agent-timeout mode outlived its sleep; Harbor must enforce the agent timeout")
        if "raise" in spec:
            raise RAISES[spec["raise"]](f"scripted provider failure: {spec['raise']}")
        for key, value in spec.get("usage", {}).items():
            setattr(context, key, value)
        context.metadata = {
            "calibrationMode": self.mode,
            "producerStatus": spec["producerStatus"],
            "termination": spec["termination"],
        }


def describe_modes() -> str:
    return json.dumps(sorted(MODES))
