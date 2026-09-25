"""Thin, pinned mini-SWE-agent direct baseline adapter.

Only the candidate fixture is mounted in the Docker tool environment. The
provider client, budget ledger, trajectory and acceptance suite stay outside.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from uuid import UUID
from pathlib import Path

from provider_budget import BudgetError, ProviderBudget, ProviderNotAdmittedError


def _read_url(request: urllib.request.Request, timeout_seconds: float, max_bytes: int) -> tuple[int, bytes]:
    """Apply an absolute deadline even if a provider drips response bytes."""
    result: dict[str, object] = {}

    def read() -> None:
        try:
            with urllib.request.urlopen(request, timeout=timeout_seconds) as reply:
                result["status"] = reply.status
                result["body"] = reply.read(max_bytes)
        except BaseException as error:  # hand the exact transport error to the caller
            result["error"] = error

    worker = threading.Thread(target=read, daemon=True)
    worker.start()
    worker.join(timeout=max(0.001, timeout_seconds))
    if worker.is_alive():
        raise TimeoutError(f"NIM request exceeded absolute deadline of {timeout_seconds:g}s")
    if "error" in result:
        raise result["error"]
    return int(result["status"]), bytes(result["body"])


def _completion_dict(response) -> dict:
    value = response.model_dump(mode="json") if hasattr(response, "model_dump") else dict(response)
    # Only completion fields enter evidence. LiteLLM's hidden request parameters
    # and transport headers may contain credentials and are deliberately omitted.
    return {key: value[key] for key in ("id", "object", "created", "model", "choices", "usage",
                                       "system_fingerprint", "service_tier") if key in value}


def _poll_nim_status(api_base: str, request_id: str, api_key: str, *, initial_payload: dict | None = None,
                     timeout_seconds: int = 300):
    """Only a pending HTTP 202 requestId is eligible for NVIDIA status polling."""
    try:
        request_id = str(UUID(request_id))
    except (ValueError, TypeError) as error:
        raise BudgetError("NIM pending response lacks a valid requestId") from error
    deadline = time.monotonic() + timeout_seconds
    trace = [{"httpStatus": 202, "requestId": request_id, "body": initial_payload}]
    url = f"{api_base.rstrip('/')}/status/{request_id}"
    while time.monotonic() < deadline:
        request = urllib.request.Request(url, headers={"Authorization": f"Bearer {api_key}",
                                                       "Accept": "application/json"})
        status, body = _read_url(request, min(30, max(0.001, deadline - time.monotonic())), 2_000_001)
        if len(body) > 2_000_000:
            raise BudgetError("NIM status response exceeds evidence size limit")
        payload = json.loads(body)
        trace.append({"httpStatus": status, "requestId": request_id, "body": payload})
        if status == 202:
            time.sleep(1)
            continue
        if status != 200 or not isinstance(payload, dict):
            raise BudgetError(f"NIM status polling failed with HTTP {status}")
        return payload, trace
    raise BudgetError("NIM status polling timed out")


def _nim_chat_completion(model_profile: dict, messages: list[dict], tools: list[dict], api_key: str,
                         max_output_tokens: int, overrides: dict | None = None):
    """Capture the actual NIM JSON before LiteLLM rewrites its model field."""
    if overrides:
        raise BudgetError("unregistered NIM request override")
    body = {"model": model_profile["providerModelId"], "messages": messages, "tools": tools,
            "tool_choice": model_profile["toolChoice"], "max_tokens": max_output_tokens,
            "temperature": model_profile["temperature"], "top_p": model_profile["topP"],
            "reasoning_budget": model_profile["reasoningBudget"], "stream": False}
    request = urllib.request.Request(f"{model_profile['apiBaseUrl'].rstrip('/')}/chat/completions",
                                     data=json.dumps(body, separators=(",", ":")).encode("utf-8"), method="POST",
                                     headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
                                              "Accept": "application/json"})
    try:
        status, encoded = _read_url(request, model_profile["requestTimeoutSeconds"], 2_000_001)
    except urllib.error.HTTPError as error:
        body = error.read(2049).decode("utf-8", errors="replace")
        if error.code in {429, 503, 529}:
            raise ProviderNotAdmittedError(error.code, error.headers.get("Retry-After"), body) from error
        raise BudgetError(f"NIM chat completion failed with HTTP {error.code}") from error
    if len(encoded) > 2_000_000:
        raise BudgetError("NIM completion exceeds evidence size limit")
    payload = json.loads(encoded)
    if not isinstance(payload, dict):
        raise BudgetError("NIM completion is not a JSON object")
    if status == 202:
        return _poll_nim_status(model_profile["apiBaseUrl"], payload.get("requestId"), api_key,
                                initial_payload=payload)
    if status != 200:
        raise BudgetError(f"NIM completion failed with HTTP {status}")
    return payload, []


def settle_provider_response(budget: ProviderBudget, request_id: str, raw: dict, model_profile: dict,
                             status_trace: list[dict] | None = None) -> dict:
    nim = model_profile.get("provider") == "nvidia_nim"
    evidence_mode = "ASYNC_STATUS_RECORD" if status_trace else model_profile.get("evidenceMode", "RETRIEVABLE_RECORD")
    try:
        evidence = budget.attest(request_id, raw, evidence_mode, status_trace,
                                 "NVIDIA_CHAT_COMPLETIONS_JSON_V1" if nim else "LITELLM_MODEL_RESPONSE_V1")
    except BaseException as error:
        budget.unknown(request_id, f"provider response attestation failed: {type(error).__name__}")
        raise
    usage = raw.get("usage")
    provider_id = raw.get("id")
    returned_model = raw.get("model")
    if nim and returned_model != model_profile["providerModelId"]:
        budget.unknown(request_id, "provider returned a different model id", evidence)
        raise BudgetError("provider returned a different model id")
    if not isinstance(usage, dict) or not provider_id or usage.get("prompt_tokens") is None or usage.get("completion_tokens") is None:
        budget.unknown(request_id, "provider response lacks id or independent usage", evidence)
        raise BudgetError("provider response lacks id or usage")
    details = usage.get("prompt_tokens_details")
    cached_tokens = details.get("cached_tokens") if isinstance(details, dict) else None
    return budget.settle(request_id, provider_id, usage["prompt_tokens"], usage["completion_tokens"], cached_tokens,
                         evidence=evidence, returned_model_id=returned_model)


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
    from minisweagent.models.utils.actions_toolcall import BASH_TOOL
    import litellm

    profile = config["profile"]
    model_profile = profile["model"]
    if model_profile["credentialEnv"] == "NVIDIA_NIM_API_KEY" and not os.getenv("NVIDIA_NIM_API_KEY") and os.getenv("NVIDIA_API_KEY"):
        # LiteLLM's nvidia_nim adapter reads this name. Keep the value out of
        # model_kwargs because mini-SWE-agent serializes that config in traces.
        os.environ["NVIDIA_NIM_API_KEY"] = os.environ["NVIDIA_API_KEY"]
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
                    "api_base": model_profile["apiBaseUrl"]}
    nim = model_profile.get("provider") == "nvidia_nim"
    if not nim:
        model_kwargs["reasoning_effort"] = model_profile["reasoningEffort"]
    else:
        model_kwargs["extra_body"] = {"reasoning_budget": model_profile["reasoningBudget"]}
        model_kwargs["tool_choice"] = model_profile["toolChoice"]
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
            if nim:
                raw, status_trace = _nim_chat_completion(model_profile, messages, [BASH_TOOL],
                                                          os.environ["NVIDIA_NIM_API_KEY"],
                                                          profile["budgets"]["maxOutputTokensPerCall"], kwargs)
            else:
                response = original_query(messages, **kwargs)
                raw = _completion_dict(response)
                status_trace = []
        except ProviderNotAdmittedError as error:
            proof = budget.record_non_admission(request_id, error.status, error.retry_after, error.body)
            budget.not_admitted(request_id, f"HTTP_{error.status}_NOT_ADMITTED", proof)
            raise
        except BaseException as error:
            budget.unknown(request_id, f"provider completion ambiguous: {type(error).__name__}")
            raise
        settle_provider_response(budget, request_id, raw, model_profile, status_trace)
        if nim:
            response = litellm.ModelResponse(**raw)
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
            system_template="You are a coding agent. Use bash to inspect and edit only /workspace. Fix the requested defect with the smallest practical change, run a quick check, then finish immediately. To submit, run: printf 'COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\\n'. Your own tests and submission do not determine acceptance.",
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
        if isinstance(error, ProviderNotAdmittedError):
            result.update({"providerAdmission": "NOT_ADMITTED", "httpStatus": error.status,
                           "retryAfter": error.retry_after, "retryAfterSeconds": error.retry_after})
        _write(result_path, result)
        return 1
    _write(result_path, result)
    return 0 if result.get("exitStatus") == "Submitted" else 1


if __name__ == "__main__":
    raise SystemExit(main())
