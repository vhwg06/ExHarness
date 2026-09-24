"""Conservative request ledger for the pinned mini-SWE-agent direct arm.

This ledger lives outside the agent's Docker workspace. Every reservation is
fsynced before the corresponding provider call. Unknown completion keeps the
full reservation and prevents another call until an operator reconciles it.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path


class BudgetError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProviderBudget:
    def __init__(self, ledger_path: str | Path, profile: dict, task_id: str, attempt_id: str):
        self.path = Path(ledger_path)
        self.profile = profile
        self.task_id = task_id
        self.attempt_id = attempt_id
        self.limits = profile["budgets"]
        self.prices = profile["model"]
        self.path.parent.mkdir(parents=True, exist_ok=True)

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
            elif event["kind"] in {"SETTLED", "UNKNOWN"}:
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
            tokens += final["inputTokens"] + final["outputTokens"]
            cost += final["costUsd"]
        return reservations, calls, tokens, cost

    def reserve(self, input_tokens: int, output_tokens: int) -> str:
        if not isinstance(input_tokens, int) or not isinstance(output_tokens, int) or input_tokens < 0 or output_tokens < 1:
            raise BudgetError("invalid token reservation")
        if input_tokens > self.limits["maxInputTokensPerCall"] or output_tokens > self.limits["maxOutputTokensPerCall"]:
            raise BudgetError("per-call token bound exceeded")
        if input_tokens + output_tokens > self.prices["maxContextTokens"]:
            raise BudgetError("model context bound exceeded")
        _, calls, used_tokens, used_cost = self._state()
        reserve_tokens = self.limits["maxInputTokensPerCall"] + self.limits["maxOutputTokensPerCall"]
        reserve_cost = (self.limits["maxInputTokensPerCall"] * self.prices["inputUsdPerMillion"] +
                        self.limits["maxOutputTokensPerCall"] * self.prices["outputUsdPerMillion"]) / 1_000_000
        if calls + 1 > self.limits["maxModelCalls"] or used_tokens + reserve_tokens > self.limits["maxTotalTokens"] or used_cost + reserve_cost > self.limits["maxApiUsd"]:
            raise BudgetError("shared task budget exhausted")
        identity = uuid.uuid4().hex
        self._append({"schemaVersion": 1, "kind": "RESERVE", "requestId": identity, "taskId": self.task_id,
                      "attemptId": self.attempt_id, "timestamp": _now(), "inputTokensReserved": self.limits["maxInputTokensPerCall"],
                      "outputTokensReserved": self.limits["maxOutputTokensPerCall"], "costUsdReserved": reserve_cost})
        return identity

    def settle(self, identity: str, provider_request_id: str, input_tokens: int, output_tokens: int,
               cached_input_tokens: int = 0) -> dict:
        events = self._events()
        reservations = {event["requestId"]: event for event in events if event["kind"] == "RESERVE"}
        if identity not in reservations or not provider_request_id:
            raise BudgetError("unknown reservation/provider request")
        if any(event["requestId"] == identity and event["kind"] != "RESERVE" for event in events):
            raise BudgetError("duplicate settlement")
        if not all(isinstance(value, int) and value >= 0 for value in [input_tokens, output_tokens, cached_input_tokens]) or cached_input_tokens > input_tokens:
            raise BudgetError("missing provider usage")
        reservation = reservations[identity]
        if input_tokens > reservation["inputTokensReserved"] or output_tokens > reservation["outputTokensReserved"]:
            self.unknown(identity, "provider usage exceeds reservation")
            raise BudgetError("provider usage exceeds reservation")
        cached_price = self.prices.get("cachedInputUsdPerMillion", self.prices["inputUsdPerMillion"])
        cost = ((input_tokens - cached_input_tokens) * self.prices["inputUsdPerMillion"] +
                cached_input_tokens * cached_price + output_tokens * self.prices["outputUsdPerMillion"]) / 1_000_000
        event = {"schemaVersion": 1, "kind": "SETTLED", "requestId": identity, "providerRequestId": provider_request_id,
                 "taskId": self.task_id, "attemptId": self.attempt_id, "timestamp": _now(), "inputTokens": input_tokens,
                 "cachedInputTokens": cached_input_tokens, "outputTokens": output_tokens, "costUsd": cost}
        self._append(event)
        self._state()
        return event

    def unknown(self, identity: str, reason: str) -> None:
        events = self._events()
        if not any(event["kind"] == "RESERVE" and event["requestId"] == identity for event in events) or any(event["kind"] != "RESERVE" and event["requestId"] == identity for event in events):
            raise BudgetError("unknown or already settled reservation")
        self._append({"schemaVersion": 1, "kind": "UNKNOWN", "requestId": identity, "taskId": self.task_id,
                      "attemptId": self.attempt_id, "timestamp": _now(), "reason": reason})
