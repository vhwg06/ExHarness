"""One-call, independently accounted provider tool-call preflight."""

from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path

from provider_budget import BudgetError, ProviderBudget, ProviderNotAdmittedError, ProviderHTTPError, ResourceBridgeError
from mini_driver import _nim_chat_completion, _write, settle_provider_response


def validate_tool_call(response: dict, expected_command: str) -> dict:
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise BudgetError("probe response has no completion choice")
    message = choices[0].get("message")
    calls = message.get("tool_calls") if isinstance(message, dict) else None
    if not isinstance(calls, list) or len(calls) != 1:
        raise BudgetError("probe response did not return exactly one tool call")
    call = calls[0]
    function = call.get("function") if isinstance(call, dict) else None
    if not isinstance(function, dict) or function.get("name") != "bash":
        raise BudgetError("probe response tool name differs from the pinned bash tool")
    try:
        arguments = json.loads(function.get("arguments", "{}"))
    except (TypeError, json.JSONDecodeError) as error:
        raise BudgetError("probe response tool arguments are not valid JSON") from error
    if not isinstance(arguments, dict) or arguments.get("command") != expected_command:
        raise BudgetError("probe response did not preserve the exact bounded command")
    return {"toolCallId": call.get("id"), "toolName": "bash", "command": expected_command}


def run(config: dict) -> dict:
    profile = config["profile"]
    model = profile["model"]
    if model.get("provider") != "nvidia_nim":
        raise BudgetError("the registered tool-call probe currently requires the pinned NVIDIA NIM route")
    if model.get("credentialEnv") == "NVIDIA_NIM_API_KEY" and not os.getenv("NVIDIA_NIM_API_KEY") and os.getenv("NVIDIA_API_KEY"):
        os.environ["NVIDIA_NIM_API_KEY"] = os.environ["NVIDIA_API_KEY"]
    if not os.getenv(model["credentialEnv"]):
        raise RuntimeError("provider credential environment variable is missing")
    command = config["probeCommand"]
    message = [{"role": "user", "content": f"Call the bash tool exactly once with this command and do not execute it yourself: {command}"}]
    import litellm
    from minisweagent.models.utils.actions_toolcall import BASH_TOOL

    tokens = litellm.token_counter(model=model["snapshot"], messages=message)
    budget = ProviderBudget(config["ledgerPath"], profile, config["probeId"], config["attemptId"],
                            config["evidenceRoot"], config["resourceContext"], config["resourceBridgePath"],
                            config.get("nodeExecutable", "node"))
    request_id = budget.reserve(tokens, profile["budgets"]["maxOutputTokensPerCall"])
    try:
        budget.send_started(request_id)
        bounded_model = {**model, "requestTimeoutSeconds": int(model["requestTimeoutSeconds"])}
        response, status_trace = _nim_chat_completion(bounded_model, message, [BASH_TOOL],
                                                      os.environ[model["credentialEnv"]],
                                                      profile["budgets"]["maxOutputTokensPerCall"])
    except ProviderNotAdmittedError as error:
        proof = budget.record_non_admission(request_id, error.status, error.retry_after, error.body)
        budget.not_admitted(request_id, f"HTTP_{error.status}_NOT_ADMITTED", proof)
        error.next_eligible_at = budget.wait_after_non_admission(request_id, error.retry_after)
        error.resource_code = "RESOURCE_WAIT"
        raise
    except ProviderHTTPError as error:
        evidence = budget.record_http_error(request_id, error.status, error.headers, error.body)
        budget.unknown(request_id, f"provider HTTP {error.status} has unresolved usage", evidence)
        raise
    except BaseException as error:
        budget.unknown(request_id, f"probe completion ambiguous: {type(error).__name__}")
        raise
    settled = settle_provider_response(budget, request_id, response, model, status_trace)
    try:
        tool_call = validate_tool_call(response, command)
    except BaseException as error:
        error.probe_settlement = {"response": response, "settled": settled}
        raise
    return {"schemaVersion": 1, "probeId": config["probeId"], "requestId": request_id, "status": "PASS",
            "providerModelId": response.get("model"), "providerRequestId": response.get("id"),
            "usage": {"inputTokens": response["usage"]["prompt_tokens"],
                      "outputTokens": response["usage"]["completion_tokens"],
                      "cachedInputTokens": response.get("usage", {}).get("prompt_tokens_details", {}).get("cached_tokens")},
            "toolCall": tool_call, "providerEvidenceRef": settled.get("providerEvidenceRef"),
            "providerEvidenceHash": settled.get("providerEvidenceHash"), "evidenceClass": "LIVE_PROVIDER_PROBE"}


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: probe_driver.py <config.json>", file=sys.stderr)
        return 2
    config = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    result_path = Path(config["resultPath"])
    try:
        result = run(config)
    except Exception as error:
        result = {"schemaVersion": 1, "probeId": config.get("probeId"), "status": "FAILED",
                  "errorType": type(error).__name__, "error": str(error)[:1024],
                  "traceback": traceback.format_exc(limit=3)}
        if isinstance(error, ProviderNotAdmittedError):
            result.update({"providerAdmission": "NOT_ADMITTED", "httpStatus": error.status,
                           "retryAfter": error.retry_after, "resourceCode": getattr(error, "resource_code", "RESOURCE_WAIT"),
                           "nextEligibleAt": getattr(error, "next_eligible_at", None)})
        if isinstance(error, ProviderHTTPError):
            result.update({"providerAdmission": "UNKNOWN", "httpStatus": error.status})
        if isinstance(error, ResourceBridgeError):
            result.update({"resourceCode": error.code, "nextEligibleAt": error.next_eligible_at})
        if isinstance(error, BudgetError):
            result["resourceCode"] = getattr(error, "code", None)
        probe_settlement = getattr(error, "probe_settlement", None)
        if probe_settlement is not None:
            settled = probe_settlement["settled"]
            response = probe_settlement["response"]
            result.update({
                "providerRequestId": response.get("id") if isinstance(response, dict) else None,
                "providerModelId": response.get("model") if isinstance(response, dict) else None,
                "usage": {
                    "inputTokens": response.get("usage", {}).get("prompt_tokens") if isinstance(response, dict) else None,
                    "outputTokens": response.get("usage", {}).get("completion_tokens") if isinstance(response, dict) else None,
                },
                "providerEvidenceRef": settled.get("providerEvidenceRef"),
                "providerEvidenceHash": settled.get("providerEvidenceHash"),
            })
        _write(result_path, result)
        return 1
    _write(result_path, result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
