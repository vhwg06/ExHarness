"""BB-086 offline GEPA bridge — Python child side (D8).

Capability boundary (by construction, not by policy):
  * reads ONLY stdin  — one JSON object per line: {id, kind, payload}
  * writes ONLY stdout — one JSON object per line: {id, kind, payload}
  * touches ONLY the run-scoped directory passed via --run-dir (checkpoints)

It has NO capability to touch the repository, the benchmark ledger, product
state, or the policy head: it never imports ExHarness code, never opens
sockets, never spawns subprocesses, and never unpickles anything — the
``pickle`` module is never imported anywhere in this file.

Protocol
--------
Request:  {"id": <str|int>, "kind": <str>, "payload": <object>}
Response: {"id": <same>, "kind": "<kind>.result", "payload": <object>}
Error:    {"id": <same|null>, "kind": "error", "payload": {"code": str, "message": str}}

Kinds: "search.request", "checkpoint.save", "checkpoint.load", "shutdown".

Only stdlib is used. ``gepa`` is NEVER imported at module import time; it is
imported lazily inside a function and only when the request payload carries
``useRealGepa: true`` (otherwise the deterministic stub runs).
"""

import argparse
import hashlib
import json
import os
import re
import sys

MAX_LINE_BYTES = 1048576  # 1 MiB

GEPA_ENGINE = "gepa"
GEPA_VERSION = "0.1.4"
GEPA_COMMIT = "d771eb21b5dd3228bc3f567293d2ccfc423fc900"

_CHECKPOINT_REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class CheckpointError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _respond(msg_id, kind, payload):
    sys.stdout.write(json.dumps({"id": msg_id, "kind": kind, "payload": payload}) + "\n")
    sys.stdout.flush()


def _error(msg_id, code, message):
    _respond(msg_id, "error", {"code": code, "message": message})


def _stub_search(candidate_seed, development_cases, config_digest):
    """Deterministic stand-in optimizer: no model calls, no GEPA import."""
    per_case = []
    for case_ref in development_cases:
        digest = hashlib.sha256(
            f"{candidate_seed}|{case_ref}|{config_digest}".encode("utf-8")
        ).hexdigest()
        score = int(digest[:8], 16) / 2**32
        per_case.append({"caseRef": case_ref, "score": score})
    aggregate = sum(item["score"] for item in per_case) / len(per_case) if per_case else 0.0
    candidate = {
        "strategy": candidate_seed,
        "digest": hashlib.sha256(
            f"{candidate_seed}|{config_digest}".encode("utf-8")
        ).hexdigest(),
        "mutation": "stub-reflection",
    }
    return {
        "candidate": candidate,
        "perCase": per_case,
        "aggregate": aggregate,
        "usage": None,
        "optimizer": {
            "engine": GEPA_ENGINE,
            "version": GEPA_VERSION,
            "commit": GEPA_COMMIT,
            "mode": "stub",
        },
    }


def _real_gepa_search(msg_id, payload):
    """Lazy, optional real-GEPA path. Never used by the default CI stub path."""
    try:
        import gepa  # noqa: F401  -- lazy import, only on explicit request
    except Exception as exc:  # pragma: no cover - requires the locked env
        _error(msg_id, "GEPA_UNAVAILABLE", f"gepa is not importable in this environment: {exc}")
        return
    # The offline bridge does not wire a live GEPA run: real optimization
    # needs the locked environment plus a model, which CI never provides.
    _error(
        msg_id,
        "REAL_GEPA_NOT_SUPPORTED",
        "real GEPA execution is not wired into this offline stub adapter; "
        "run it explicitly in the locked environment instead",
    )


def _handle_search(msg_id, payload):
    if not isinstance(payload, dict):
        _error(msg_id, "INVALID_PAYLOAD", "search.request payload must be an object")
        return
    if payload.get("useRealGepa"):
        _real_gepa_search(msg_id, payload)
        return
    candidate_seed = payload.get("candidateSeed")
    development_cases = payload.get("developmentCases")
    config_digest = payload.get("configDigest")
    if (
        not isinstance(candidate_seed, str)
        or not isinstance(development_cases, list)
        or not all(isinstance(c, str) for c in development_cases)
        or not isinstance(config_digest, str)
    ):
        _error(
            msg_id,
            "INVALID_PAYLOAD",
            "search.request needs {candidateSeed: str, developmentCases: str[], configDigest: str}",
        )
        return
    _respond(msg_id, "search.request.result", _stub_search(candidate_seed, development_cases, config_digest))


def _checkpoint_path(run_dir, ref):
    if not isinstance(ref, str) or not _CHECKPOINT_REF_RE.match(ref):
        raise CheckpointError(
            "INVALID_CHECKPOINT_REF",
            "checkpointRef must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ "
            "(relative name only, no directories)",
        )
    if ref.endswith(".pkl") or "pkl" in ref.lower():
        # Never unpickle: pickle state is never ExHarness evidence.
        raise CheckpointError(
            "PICKLE_REJECTED",
            "pickle checkpoints are rejected; only JSON checkpoints load",
        )
    base = os.path.realpath(run_dir)
    path = os.path.realpath(os.path.join(base, ref + ".json"))
    if path != base and not path.startswith(base + os.sep):
        raise CheckpointError("FOREIGN_CHECKPOINT", "checkpoint resolves outside the run directory")
    if os.path.dirname(path) != base:
        raise CheckpointError("FOREIGN_CHECKPOINT", "checkpoint resolves outside the run directory")
    return path


def _handle_checkpoint_save(msg_id, payload, run_dir):
    if not isinstance(payload, dict):
        _error(msg_id, "INVALID_PAYLOAD", "checkpoint.save payload must be an object")
        return
    try:
        path = _checkpoint_path(run_dir, payload.get("checkpointRef"))
    except CheckpointError as exc:
        _error(msg_id, exc.code, str(exc))
        return
    state = payload.get("state")
    try:
        serialized = json.dumps(state)
    except (TypeError, ValueError):
        _error(msg_id, "INVALID_STATE", "checkpoint state must be JSON-serializable")
        return
    try:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(serialized)
    except OSError as exc:
        _error(msg_id, "CHECKPOINT_IO", f"could not write checkpoint: {exc}")
        return
    _respond(msg_id, "checkpoint.save.result", {"checkpointRef": payload.get("checkpointRef")})


def _handle_checkpoint_load(msg_id, payload, run_dir):
    if not isinstance(payload, dict):
        _error(msg_id, "INVALID_PAYLOAD", "checkpoint.load payload must be an object")
        return
    try:
        path = _checkpoint_path(run_dir, payload.get("checkpointRef"))
    except CheckpointError as exc:
        _error(msg_id, exc.code, str(exc))
        return
    if not os.path.exists(path):
        _error(msg_id, "NOT_FOUND", "no such checkpoint in this run directory")
        return
    try:
        with open(path, "r", encoding="utf-8") as handle:
            state = json.load(handle)
    except (OSError, ValueError) as exc:
        _error(msg_id, "CHECKPOINT_IO", f"could not read checkpoint: {exc}")
        return
    _respond(
        msg_id,
        "checkpoint.load.result",
        {"checkpointRef": payload.get("checkpointRef"), "state": state},
    )


def _handle_message(message, run_dir):
    if not isinstance(message, dict) or "id" not in message or "kind" not in message:
        _error(message.get("id") if isinstance(message, dict) else None,
               "INVALID_MESSAGE", "message must be {id, kind, payload}")
        return True
    msg_id = message["id"]
    kind = message["kind"]
    payload = message.get("payload")
    if not isinstance(kind, str):
        _error(msg_id, "INVALID_MESSAGE", "message.kind must be a string")
        return True
    try:
        if kind == "search.request":
            _handle_search(msg_id, payload)
        elif kind == "checkpoint.save":
            _handle_checkpoint_save(msg_id, payload, run_dir)
        elif kind == "checkpoint.load":
            _handle_checkpoint_load(msg_id, payload, run_dir)
        elif kind == "shutdown":
            _respond(msg_id, "shutdown.result", {"ok": True})
            return False
        else:
            _error(msg_id, "UNKNOWN_KIND", f"unknown kind: {kind}")
    except Exception as exc:  # fail the message, never the loop
        _error(msg_id, "INTERNAL", f"adapter error: {exc}")
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description="BB-086 offline GEPA bridge adapter")
    parser.add_argument("--run-dir", required=True, help="run-scoped checkpoint directory")
    args = parser.parse_args(argv)
    run_dir = os.path.abspath(args.run_dir)
    os.makedirs(run_dir, exist_ok=True)

    stdin = sys.stdin.buffer
    while True:
        raw = stdin.readline()
        if raw == b"":
            break  # EOF
        if len(raw) > MAX_LINE_BYTES:
            _error(None, "OVERSIZED", f"line exceeds {MAX_LINE_BYTES} bytes; dropped")
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            _error(None, "MALFORMED_JSON", "line is not valid UTF-8")
            continue
        if not text.strip():
            continue
        try:
            message = json.loads(text)
        except json.JSONDecodeError:
            _error(None, "MALFORMED_JSON", "line is not valid JSON")
            continue
        if not _handle_message(message, run_dir):
            break
    return 0


if __name__ == "__main__":
    sys.exit(main())
