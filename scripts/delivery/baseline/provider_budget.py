"""Conservative request ledger for the pinned mini-SWE-agent direct arm.

This ledger lives outside the agent's Docker workspace. Every reservation is
fsynced before the corresponding provider call. Unknown completion keeps the
full reservation and prevents another call until an operator reconciles it.
"""

from __future__ import annotations

import json
import hashlib
import os
import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path


class BudgetError(RuntimeError):
    def __init__(self, message: str, code: str | None = None):
        super().__init__(message)
        self.code = code


class ProviderNotAdmittedError(BudgetError):
    """The provider rejected admission before a model request was accepted."""

    def __init__(self, status: int, retry_after: str | None, body: str, headers: dict | None = None):
        super().__init__(f"provider request was not admitted with HTTP {status}")
        self.status = status
        self.retry_after = retry_after
        self.body = body
        self.headers = headers or {}


class ProviderHTTPError(BudgetError):
    """A provider returned an HTTP error whose admission/usage is unresolved."""

    def __init__(self, status: int, headers: dict, body: str):
        super().__init__(f"provider request returned HTTP {status}; usage is unresolved")
        self.status = status
        self.headers = headers
        self.body = body


class ResourceBridgeError(BudgetError):
    def __init__(self, code: str, message: str, next_eligible_at: str | None = None):
        super().__init__(message)
        self.code = code
        self.next_eligible_at = next_eligible_at


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProviderBudget:
    def __init__(self, ledger_path: str | Path, profile: dict, task_id: str, attempt_id: str,
                 evidence_root: str | Path | None = None, resource_context: dict | None = None,
                 resource_bridge_path: str | Path | None = None, node_executable: str = 'node'):
        if not re.fullmatch(r"[A-Za-z0-9-]+", task_id):
            raise BudgetError("invalid task id for provider evidence path")
        self.path = Path(ledger_path)
        self.evidence_root = Path(evidence_root).resolve() if evidence_root else self.path.parent.parent.resolve()
        self.profile = profile
        self.task_id = task_id
        self.attempt_id = attempt_id
        self.limits = profile["budgets"]
        self.prices = profile["model"]
        self.resource_context = resource_context
        self.resource_bridge_path = Path(resource_bridge_path).resolve() if resource_bridge_path else None
        self.node_executable = node_executable
        self.provider_wait_seconds = 0.0
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _resource_action(self, kind: str, **values) -> dict:
        if not self.resource_context or not self.resource_bridge_path:
            return {}
        payload = json.dumps({"resource": self.resource_context, "action": {"kind": kind, **values}}, separators=(",", ":"))
        try:
            result = subprocess.run([self.node_executable, str(self.resource_bridge_path)], input=payload,
                                    text=True, capture_output=True, timeout=30, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ResourceBridgeError("RESOURCE_BRIDGE_FAILURE", f"shared resource journal unavailable: {type(error).__name__}") from error
        try:
            response = json.loads(result.stdout)
        except (json.JSONDecodeError, TypeError) as error:
            raise ResourceBridgeError("RESOURCE_BRIDGE_FAILURE", "shared resource journal returned invalid response") from error
        if result.returncode != 0 or not response.get("ok"):
            detail = response.get("error", {})
            raise ResourceBridgeError(detail.get("code", "RESOURCE_BRIDGE_FAILURE"),
                                      detail.get("message", "shared resource journal rejected request"),
                                      detail.get("nextEligibleAt"))
        return response.get("result", {})

    @staticmethod
    def _retry_after_seconds(value: str | None) -> float | None:
        if value is None or not str(value).strip():
            return None
        text = str(value).strip()
        if re.fullmatch(r"\d+(?:\.\d+)?", text):
            return float(text)
        try:
            from email.utils import parsedate_to_datetime
            parsed = parsedate_to_datetime(text)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return max(0.0, (parsed - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None

    def attest(self, identity: str, response: dict, mode: str, status_trace: list[dict] | None = None,
               capture_format: str = "LITELLM_MODEL_RESPONSE_V1") -> dict:
        """Persist the provider completion outside the agent workspace before settlement."""
        if not any(event["kind"] == "RESERVE" and event["requestId"] == identity for event in self._events()):
            raise BudgetError("provider response has no reservation")
        if mode not in {"ORIGINAL_RESPONSE_ATTESTED", "ASYNC_STATUS_RECORD", "RETRIEVABLE_RECORD"}:
            raise BudgetError("unknown provider evidence mode")
        record = {"schemaVersion": 1, "evidenceMode": mode, "captureFormat": capture_format,
                  "requestId": identity, "taskId": self.task_id, "capturedAt": _now(),
                  "response": response, "statusTrace": status_trace or []}
        encoded = (json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
        directory = self.path.parent / "provider-responses"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{identity}.json"
        with path.open("xb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        return {"providerEvidenceMode": mode,
                "providerEvidenceRef": path.resolve().relative_to(self.evidence_root).as_posix(),
                "providerEvidenceHash": f"sha256:{hashlib.sha256(encoded).hexdigest()}"}

    def record_non_admission(self, identity: str, status: int, retry_after: str | None, body: str = "") -> dict:
        """Capture bounded provider proof before releasing a reservation."""
        if not any(event["kind"] == "RESERVE" and event["requestId"] == identity for event in self._events()):
            raise BudgetError("non-admission has no reservation")
        record = {"schemaVersion": 1, "evidenceClass": "PROVIDER_NON_ADMISSION", "requestId": identity,
                  "taskId": self.task_id, "capturedAt": _now(), "httpStatus": int(status),
                  "retryAfter": retry_after, "body": str(body or "")[:2048]}
        encoded = (json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
        directory = self.path.parent / "provider-admission"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{identity}.json"
        with path.open("xb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        return {"ref": path.resolve().relative_to(self.evidence_root).as_posix(),
                "hash": f"sha256:{hashlib.sha256(encoded).hexdigest()}", "httpStatus": int(status),
                "retryAfter": retry_after}

    def record_http_error(self, identity: str, status: int, headers: dict, body: str) -> dict:
        """Persist a bounded error response while retaining UNKNOWN usage."""
        if not any(event["kind"] == "RESERVE" and event["requestId"] == identity for event in self._events()):
            raise BudgetError("provider error has no reservation")
        record = {"schemaVersion": 1, "evidenceClass": "PROVIDER_HTTP_ERROR", "requestId": identity,
                  "taskId": self.task_id, "capturedAt": _now(), "httpStatus": int(status),
                  "headers": headers, "body": str(body or "")[:2048]}
        encoded = (json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
        directory = self.path.parent / "provider-errors"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{identity}.json"
        with path.open("xb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        return {"ref": path.resolve().relative_to(self.evidence_root).as_posix(),
                "hash": f"sha256:{hashlib.sha256(encoded).hexdigest()}", "httpStatus": int(status)}

    def _events(self) -> list[dict]:
        if not self.path.exists():
            return []
        return [json.loads(line) for line in self.path.read_text(encoding="utf-8").splitlines() if line]

    def _append(self, event: dict) -> None:
        encoded = json.dumps(event, sort_keys=True, separators=(",", ":")) + "\n"
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())

    def _state(self) -> tuple[dict[str, dict], int, int, float]:
        reservations: dict[str, dict] = {}
        settled: dict[str, dict] = {}
        for event in self._events():
            identity = event["requestId"]
            if event["kind"] == "RESERVE":
                if identity in reservations:
                    raise BudgetError("duplicate reservation")
                reservations[identity] = event
            elif event["kind"] in {"SETTLED", "UNKNOWN", "NOT_ADMITTED"}:
                if identity not in reservations or identity in settled:
                    raise BudgetError("settlement without unique reservation")
                settled[identity] = event
            else:
                raise BudgetError("unknown ledger event")
        calls = len(reservations)
        tokens = 0
        cost = 0.0
        for identity, reservation in reservations.items():
            final = settled.get(identity)
            if final is None or final["kind"] == "UNKNOWN":
                raise BudgetError("unresolved provider request reservation")
            if final["kind"] == "SETTLED":
                tokens += final["inputTokens"] + final["outputTokens"]
                cost += final["costUsd"]
        return reservations, calls, tokens, cost

    def reserve(self, input_tokens: int, output_tokens: int) -> str:
        if not isinstance(input_tokens, int) or not isinstance(output_tokens, int) or input_tokens < 0 or output_tokens < 1:
            raise BudgetError("invalid token reservation")
        if input_tokens > self.limits["maxInputTokensPerCall"] or output_tokens > self.limits["maxOutputTokensPerCall"]:
            raise BudgetError("per-call token bound exceeded", "RESOURCE_LIMIT_EXCEEDED")
        if input_tokens + output_tokens > self.prices["maxContextTokens"]:
            raise BudgetError("model context bound exceeded", "RESOURCE_LIMIT_EXCEEDED")
        _, calls, used_tokens, used_cost = self._state()
        reserve_input_tokens = self.limits["maxInputTokensPerCall"]
        reserve_output_tokens = self.limits["maxOutputTokensPerCall"]
        reserve_tokens = reserve_input_tokens + reserve_output_tokens
        input_price = max(self.prices["inputUsdPerMillion"], self.prices.get("cachedInputUsdPerMillion", self.prices["inputUsdPerMillion"]))
        reserve_cost = (reserve_input_tokens * input_price + reserve_output_tokens * self.prices["outputUsdPerMillion"]) / 1_000_000
        max_wire = self.limits.get("maxWireRequestsPerExecution", self.limits["maxModelCalls"])
        if calls + 1 > max_wire or calls + 1 > self.limits["maxModelCalls"] or used_tokens + reserve_tokens > self.limits["maxTotalTokens"] or used_cost + reserve_cost > self.limits["maxApiUsd"]:
            raise BudgetError("shared task budget exhausted", "RESOURCE_LIMIT_EXCEEDED")
        identity = uuid.uuid4().hex
        if self.resource_context and self.resource_bridge_path:
            self._resource_action("reserve", executionId=self.resource_context["executionId"],
                                  attemptId=self.attempt_id, requestId=identity,
                                  inputTokens=reserve_input_tokens, outputTokens=reserve_output_tokens, costUsd=reserve_cost)
        self._append({"schemaVersion": 1, "kind": "RESERVE", "requestId": identity, "taskId": self.task_id,
                      "attemptId": self.attempt_id, "timestamp": _now(), "inputTokensReserved": reserve_input_tokens,
                      "outputTokensReserved": reserve_output_tokens, "costUsdReserved": reserve_cost})
        return identity

    def send_started(self, identity: str) -> None:
        if self.resource_context and self.resource_bridge_path:
            self._resource_action("sendStarted", executionId=self.resource_context["executionId"],
                                  attemptId=self.attempt_id, requestId=identity)

    def settle(self, identity: str, provider_request_id: str, input_tokens: int, output_tokens: int,
               cached_input_tokens: int | None = None, evidence: dict | None = None,
               returned_model_id: str | None = None) -> dict:
        events = self._events()
        reservations = {event["requestId"]: event for event in events if event["kind"] == "RESERVE"}
        if identity not in reservations or not provider_request_id:
            raise BudgetError("unknown reservation/provider request")
        if any(event["requestId"] == identity and event["kind"] != "RESERVE" for event in events):
            raise BudgetError("duplicate settlement")
        if not all(isinstance(value, int) and value >= 0 for value in [input_tokens, output_tokens]) or \
                (cached_input_tokens is not None and (not isinstance(cached_input_tokens, int) or cached_input_tokens < 0 or cached_input_tokens > input_tokens)):
            raise BudgetError("missing provider usage")
        if self.prices.get("evidenceMode") == "ORIGINAL_RESPONSE_ATTESTED" and not evidence:
            self.unknown(identity, "original provider response was not attested")
            raise BudgetError("original provider response was not attested")
        reservation = reservations[identity]
        if input_tokens > reservation["inputTokensReserved"] or output_tokens > reservation["outputTokensReserved"]:
            self.unknown(identity, "provider usage exceeds reservation")
            raise BudgetError("provider usage exceeds reservation")
        cached_price = self.prices.get("cachedInputUsdPerMillion", self.prices["inputUsdPerMillion"])
        if cached_input_tokens is None and cached_price != self.prices["inputUsdPerMillion"]:
            self.unknown(identity, "cache usage not reported with differential pricing", evidence)
            raise BudgetError("cache usage not reported with differential pricing")
        priced_cached_tokens = cached_input_tokens if cached_input_tokens is not None else 0
        cost = ((input_tokens - priced_cached_tokens) * self.prices["inputUsdPerMillion"] +
                priced_cached_tokens * cached_price + output_tokens * self.prices["outputUsdPerMillion"]) / 1_000_000
        event = {"schemaVersion": 1, "kind": "SETTLED", "requestId": identity, "providerRequestId": provider_request_id,
                 "taskId": self.task_id, "attemptId": self.attempt_id, "timestamp": _now(), "inputTokens": input_tokens,
                 "cachedInputTokens": cached_input_tokens,
                 "cacheEvidence": "REPORTED" if cached_input_tokens is not None else "NOT_REPORTED",
                 "outputTokens": output_tokens, "costUsd": cost, "returnedModelId": returned_model_id,
                 **(evidence or {})}
        self._append(event)
        self._state()
        if self.resource_context and self.resource_bridge_path:
            try:
                self._resource_action("settled", executionId=self.resource_context["executionId"],
                                      attemptId=self.attempt_id, requestId=identity,
                                      providerRequestId=provider_request_id,
                                      responseHash=(evidence or {}).get("providerEvidenceHash", "sha256:unattested"),
                                      usage={"inputTokens": input_tokens, "cachedInputTokens": cached_input_tokens,
                                             "outputTokens": output_tokens, "costUsd": cost},
                                      proof={"providerEvidenceRef": (evidence or {}).get("providerEvidenceRef")})
            except ResourceBridgeError:
                try:
                    self._resource_action("unknown", executionId=self.resource_context["executionId"],
                                          attemptId=self.attempt_id, requestId=identity,
                                          reason="shared resource settlement failed",
                                          proof={"providerEvidenceRef": (evidence or {}).get("providerEvidenceRef"),
                                                 "providerEvidenceHash": (evidence or {}).get("providerEvidenceHash")})
                except ResourceBridgeError:
                    pass
                raise
        return event

    def unknown(self, identity: str, reason: str, evidence: dict | None = None) -> None:
        events = self._events()
        if not any(event["kind"] == "RESERVE" and event["requestId"] == identity for event in events) or any(event["kind"] != "RESERVE" and event["requestId"] == identity for event in events):
            raise BudgetError("unknown or already settled reservation")
        self._append({"schemaVersion": 1, "kind": "UNKNOWN", "requestId": identity, "taskId": self.task_id,
                      "attemptId": self.attempt_id, "timestamp": _now(), "reason": reason, **(evidence or {})})
        if self.resource_context and self.resource_bridge_path:
            try:
                self._resource_action("unknown", executionId=self.resource_context["executionId"],
                                      attemptId=self.attempt_id, requestId=identity, reason=reason,
                                      proof={"ref": (evidence or {}).get("ref") or (evidence or {}).get("providerEvidenceRef"),
                                             "hash": (evidence or {}).get("hash") or (evidence or {}).get("providerEvidenceHash")})
            except ResourceBridgeError:
                pass

    def not_admitted(self, identity: str, reason: str, proof: dict) -> None:
        """Release a reservation only with durable proof that no provider call was admitted."""
        events = self._events()
        if not any(event["kind"] == "RESERVE" and event["requestId"] == identity for event in events) or any(event["kind"] != "RESERVE" and event["requestId"] == identity for event in events):
            raise BudgetError("unknown or already settled reservation")
        if not isinstance(proof, dict) or not proof.get("ref") or not proof.get("hash"):
            raise BudgetError("non-admission proof ref/hash required")
        self._append({"schemaVersion": 1, "kind": "NOT_ADMITTED", "requestId": identity, "taskId": self.task_id,
                      "attemptId": self.attempt_id, "timestamp": _now(), "reason": reason, "proof": proof})
        if self.resource_context and self.resource_bridge_path:
            self._resource_action("notAdmitted", executionId=self.resource_context["executionId"],
                                  attemptId=self.attempt_id, requestId=identity,
                                  proofRef=proof["ref"], proofHash=proof["hash"], reason=reason)

    def wait_after_non_admission(self, identity: str, retry_after: str | None) -> str | None:
        if not self.resource_context or not self.resource_bridge_path:
            return None
        prior = sum(event["kind"] == "NOT_ADMITTED" for event in self._events())
        backoff = min(60 * (2 ** max(0, prior - 1)), 3600)
        requested = self._retry_after_seconds(retry_after) or 0.0
        seed = self.resource_context.get("seed", 0)
        jitter_ms = int(hashlib.sha256(f"{seed}:{identity}".encode("utf-8")).hexdigest()[:8], 16) % 5001
        wait_seconds = max(backoff + jitter_ms / 1000, requested)
        next_at = datetime.now(timezone.utc).timestamp() + wait_seconds
        next_iso = datetime.fromtimestamp(next_at, timezone.utc).isoformat().replace("+00:00", "Z")
        self._resource_action("wait", executionId=self.resource_context["executionId"],
                              nextAt=next_iso, waitMs=round(wait_seconds * 1000),
                              reason="PROVIDER_NON_ADMISSION_BACKOFF", routeWide=True)
        return next_iso
