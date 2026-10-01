#!/usr/bin/env python3
"""BB-083 S6 - offline GEPA bridge worker (Python side).

JSON-lines subprocess worker owned by the Node orchestrator
(scripts/feedback/gepa-bridge.mjs). Reads ONE JSON request line from
stdin, writes ONE JSON response line to stdout.

Request:  { "op": "optimize"|"reconcile"|"health", "stateDir": "<dir>", "payload": {...} }
Response: one JSON object on a single stdout line.

  "health"    -> { "status": "OK", "gepa": "<version|stub>" }
                 Works WITHOUT gepa installed (graceful stub).
  "optimize"  -> { "status": "SETTLED", "operationRef", "resultDigest", "proposal" }
                 or { "status": "REPLAYED", "operationRef", "resultDigest" } when the
                 durable receipt already exists (idempotent: no recompute, no
                 duplicate dispatch-count increment), or
                 { "status": "UNAVAILABLE", "reason": "gepa-not-installed" } when gepa
                 cannot be imported (never crashes).
  "reconcile" -> { "status": "REPLAYED", "operationRef", "resultDigest" } when the
                 durable receipt exists, else { "status": "UNKNOWN", "operationRef" }.

Durability semantics:
  - optimize checks the durable receipt {operationRef}.receipt.json FIRST.
    If present it replays from the receipt without recomputing and without
    incrementing dispatch-counts.json.
  - Otherwise it increments dispatch-counts.json, computes the proposal,
    writes the receipt ATOMICALLY (temp file + os.replace), and only then
    prints the result line. A crash between receipt write and print
    (crash_after_commit) is recoverable: the Node side reconciles and
    replays the SAME receipt, never dispatching twice.
  - The worker NEVER touches the repository, benchmark ledger, product
    state, or policy head - it only writes receipts under stateDir.
  - The worker NEVER emits accepted/promoted/verdict fields; it normalizes
    only a proposal envelope.

Test fixtures (environment variables, deterministic):
  GEPA_BRIDGE_CRASH_AFTER_COMMIT=1  -> os._exit(23) after the receipt is
      written but before the result line is printed.
  GEPA_BRIDGE_BLOCK_BEFORE_COMMIT=1 -> print {"status":"STARTED",...} then
      sleep before any commit, so cancellation can be probed (no receipt,
      no dispatch-count increment).
  GEPA_BRIDGE_FORCE_NO_GEPA=1       -> behave as if gepa is not installed
      (deterministic stub path even on machines that have gepa).
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path

ADAPTER_VERSION = "0.1.0"
RECEIPT_SUFFIX = ".receipt.json"
DISPATCH_COUNTS = "dispatch-counts.json"
CRASH_EXIT_CODE = 23


def _gepa_version() -> str:
    """gepa version string, or "stub" when gepa is unavailable."""
    if os.environ.get("GEPA_BRIDGE_FORCE_NO_GEPA") == "1":
        return "stub"
    try:
        import gepa  # noqa: PLC0415
    except Exception:
        return "stub"
    return str(getattr(gepa, "__version__", "unknown"))


def _canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _operation_ref(payload: dict):
    ref = payload.get("operationRef")
    return ref if isinstance(ref, str) and ref else None


def _read_dispatch_counts(dispatch_file: Path) -> dict:
    if dispatch_file.exists():
        try:
            data = json.loads(dispatch_file.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except (OSError, ValueError):
            pass
    return {}


def _write_receipt_atomically(receipt: Path, payload: dict) -> None:
    """Atomic commit point: temp file + os.replace, flushed before print."""
    receipt.parent.mkdir(parents=True, exist_ok=True)
    tmp = receipt.with_name(receipt.name + ".tmp")
    tmp.write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(receipt)


def _op_health() -> dict:
    return {"status": "OK", "gepa": _gepa_version(), "adapter": ADAPTER_VERSION}


def _op_optimize(state_dir: Path, payload: dict) -> dict:
    operation_ref = _operation_ref(payload)
    if operation_ref is None:
        return {"status": "ERROR", "reason": "missing-operationRef"}

    receipt = state_dir / f"{operation_ref}{RECEIPT_SUFFIX}"

    # Idempotent replay: a committed receipt is returned as-is - no
    # recompute and no duplicate dispatch-count increment.
    if receipt.exists():
        try:
            existing = json.loads(receipt.read_text(encoding="utf-8"))
            return {
                "status": "REPLAYED",
                "operationRef": operation_ref,
                "resultDigest": existing.get("resultDigest"),
            }
        except (OSError, ValueError):
            pass  # Unreadable receipt: fall through and recompute below.

    # Deterministic cancellation probe: block BEFORE any commit so a
    # cancelled dispatch leaves no receipt and no dispatch-count record.
    if os.environ.get("GEPA_BRIDGE_BLOCK_BEFORE_COMMIT") == "1":
        print(
            json.dumps({"status": "STARTED", "operationRef": operation_ref}),
            flush=True,
        )
        time.sleep(3600)

    gepa_version = _gepa_version()
    if gepa_version == "stub":
        # Graceful degradation: the pinned GEPA dependency is optional at
        # runtime. Report UNAVAILABLE instead of crashing.
        return {
            "status": "UNAVAILABLE",
            "operationRef": operation_ref,
            "reason": "gepa-not-installed",
        }

    prompt = payload.get("prompt")
    seed_candidates = payload.get("seedCandidates", [])
    result_digest = _sha256_hex(
        _canonical({"prompt": prompt, "seedCandidates": seed_candidates})
    )
    # Proposal envelope only: never accepted/promoted/verdict fields.
    proposal = {
        "prompt": prompt,
        "seedCandidates": seed_candidates,
        "seedCandidateCount": (
            len(seed_candidates) if isinstance(seed_candidates, list) else 0
        ),
        "resultDigest": result_digest,
        "engine": f"gepa-{gepa_version}",
    }
    result = {
        "status": "SETTLED",
        "operationRef": operation_ref,
        "resultDigest": result_digest,
        "proposal": proposal,
    }

    dispatch_file = state_dir / DISPATCH_COUNTS
    counts = _read_dispatch_counts(dispatch_file)
    counts[operation_ref] = counts.get(operation_ref, 0) + 1
    dispatch_file.write_text(
        json.dumps(counts, sort_keys=True) + "\n", encoding="utf-8"
    )

    _write_receipt_atomically(receipt, result)

    # Deterministic crash probe: receipt committed, result line never printed.
    if os.environ.get("GEPA_BRIDGE_CRASH_AFTER_COMMIT") == "1":
        os._exit(CRASH_EXIT_CODE)

    return result


def _op_reconcile(state_dir: Path, payload: dict) -> dict:
    operation_ref = _operation_ref(payload)
    if operation_ref is None:
        return {"status": "ERROR", "reason": "missing-operationRef"}
    receipt = state_dir / f"{operation_ref}{RECEIPT_SUFFIX}"
    if not receipt.exists():
        return {"status": "UNKNOWN", "operationRef": operation_ref}
    try:
        existing = json.loads(receipt.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"status": "UNKNOWN", "operationRef": operation_ref}
    return {
        "status": "REPLAYED",
        "operationRef": operation_ref,
        "resultDigest": existing.get("resultDigest"),
    }


def _needs_state_dir(op: str) -> bool:
    return op in ("optimize", "reconcile")


def _respond(response: dict) -> int:
    print(json.dumps(response, sort_keys=True), flush=True)
    return 0


def main() -> int:
    line = sys.stdin.readline()
    try:
        request = json.loads(line)
    except ValueError:
        return _respond({"status": "ERROR", "reason": "bad-request"})
    if not isinstance(request, dict):
        return _respond({"status": "ERROR", "reason": "bad-request"})

    op = request.get("op")
    payload = request.get("payload") or {}
    if not isinstance(payload, dict):
        return _respond({"status": "ERROR", "reason": "bad-payload"})

    if op == "health":
        return _respond(_op_health())
    if _needs_state_dir(op):
        state_dir_raw = request.get("stateDir")
        if not isinstance(state_dir_raw, str) or not state_dir_raw:
            return _respond({"status": "ERROR", "reason": "missing-stateDir"})
        state_dir = Path(state_dir_raw)
        if op == "optimize":
            return _respond(_op_optimize(state_dir, payload))
        return _respond(_op_reconcile(state_dir, payload))
    return _respond({"status": "ERROR", "reason": f"unknown-op:{op}"})


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # Protocol-friendly: one JSON line, never a traceback.
        print(json.dumps({"status": "ERROR", "reason": f"internal:{exc}"}), flush=True)
        sys.exit(1)
