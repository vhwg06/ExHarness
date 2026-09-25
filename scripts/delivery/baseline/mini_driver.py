"""Thin, pinned mini-SWE-agent direct baseline adapter.

Only the candidate fixture is mounted in the Docker tool environment. The
provider client, budget ledger, trajectory and acceptance suite stay outside.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import traceback
from pathlib import Path

from provider_budget import BudgetError, ProviderBudget


def _write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, sort_keys=True, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def run(config: dict) -> dict:
    from minisweagent.agents.default import DefaultAgent
    from minisweagent.environments.docker import DockerEnvironment
    from minisweagent.models import get_model
    import litellm

    profile = config["profile"]
    model_profile = profile["model"]
    if not os.getenv(model_profile["credentialEnv"]):
        raise RuntimeError("provider credential environment variable is missing")
    if os.getenv("MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT", "1") != "1":
        raise RuntimeError("hidden mini-SWE-agent provider retries must be disabled")
    os.environ["MSWEA_MODEL_RETRY_STOP_AFTER_ATTEMPT"] = "1"
    candidate = Path(config["candidateDir"]).resolve(strict=True)
    if not candidate.is_dir() or any(path.is_symlink() for path in candidate.iterdir()):
        raise RuntimeError("candidate workspace is not a plain directory")
    attempt_id = config["attemptId"]
    budget = ProviderBudget(config["ledgerPath"], profile, config["taskId"], attempt_id)
    model_kwargs = {"num_retries": 0, "max_tokens": profile["budgets"]["maxOutputTokensPerCall"],
                    "api_base": model_profile["apiBaseUrl"],
                    "reasoning_effort": model_profile["reasoningEffort"]}
    if model_profile["credentialEnv"] == "OPENAI_API_KEY":
        model_kwargs.update({"store": True, "service_tier": "default"})
    model = get_model(model_profile["snapshot"], config={
        "model_class": "litellm",
        "model_kwargs": model_kwargs,
        "cost_tracking": "ignore_errors",
    })
    original_query = model._query

    def budgeted_query(messages: list[dict], **kwargs):
        prepared = messages
        try:
            input_tokens = litellm.token_counter(model=model_profile["snapshot"], messages=prepared)
        except Exception as error:
            raise BudgetError(f"pinned tokenizer could not count request: {error}") from error
        request_id = budget.reserve(input_tokens, profile["budgets"]["maxOutputTokensPerCall"])
        try:
            response = original_query(messages, **kwargs)
        except BaseException as error:
            budget.unknown(request_id, f"provider completion ambiguous: {type(error).__name__}")
            raise
        usage = getattr(response, "usage", None)
        provider_id = getattr(response, "id", None)
        if usage is None or not provider_id or getattr(usage, "prompt_tokens", None) is None or getattr(usage, "completion_tokens", None) is None:
            budget.unknown(request_id, "provider response lacks id or independent usage")
            raise BudgetError("provider response lacks id or usage")
        details = getattr(usage, "prompt_tokens_details", None)
        cached_tokens = getattr(details, "cached_tokens", 0) if details is not None else 0
        budget.settle(request_id, provider_id, usage.prompt_tokens, usage.completion_tokens, cached_tokens)
        return response

    model._query = budgeted_query
    image = profile["agentImage"]
    if "@sha256:" not in image:
        raise RuntimeError("agent image must be pinned by digest")
    mount = f"type=bind,src={candidate},dst=/workspace"
    environment = DockerEnvironment(
        image=image,
        cwd="/workspace",
        timeout=profile["budgets"]["maxToolCommandSeconds"],
        run_args=["--rm", "--network=none", "--label", f"exharness-attempt={attempt_id}", "--mount", mount],
        forward_env=[],
    )
    try:
        agent = DefaultAgent(
            model, environment,
            system_template="You are a coding agent. Use the bash tool to inspect and edit only /workspace. Do not assume your submission is accepted. Finish by running a command whose first output line is COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT.",
            instance_template="{{ task }}",
            step_limit=profile["budgets"]["maxModelCalls"],
            cost_limit=profile["budgets"]["maxApiUsd"],
            wall_time_limit_seconds=profile["budgets"]["maxWallSeconds"],
            output_path=Path(config["trajectoryPath"]),
        )
        result = agent.run(config["taskPrompt"])
        return {"schemaVersion": 1, "exitStatus": result.get("exit_status"), "submission": result.get("submission", ""),
                "modelCalls": agent.n_calls, "reportedAgentCostUsd": agent.cost, "containerId": environment.container_id}
    finally:
        if environment.container_id:
            subprocess.run(["docker", "rm", "-f", environment.container_id], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=30, check=False)
            environment.container_id = None


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: mini_driver.py <config.json>", file=sys.stderr)
        return 2
    config = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    result_path = Path(config["resultPath"])
    try:
        result = run(config)
    except Exception as error:
        result = {"schemaVersion": 1, "exitStatus": "FAILED", "errorType": type(error).__name__,
                  "error": str(error), "traceback": traceback.format_exc(limit=4)}
        _write(result_path, result)
        return 1
    _write(result_path, result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
