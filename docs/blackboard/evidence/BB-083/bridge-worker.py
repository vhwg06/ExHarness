import json, os, sys, time
from pathlib import Path

req = json.loads(sys.stdin.readline())
state = Path(req["stateDir"])
state.mkdir(parents=True, exist_ok=True)
operation_ref = req["operationRef"]
mode = req.get("mode", "normal")
receipt = state / f"{operation_ref}.receipt.json"
dispatch_file = state / "dispatch-counts.json"

if mode == "reconcile":
    if not receipt.exists():
        print(json.dumps({"status": "MISSING"}), flush=True)
        sys.exit(0)
    out = json.loads(receipt.read_text())
    out["status"] = "REPLAYED"
    print(json.dumps(out), flush=True)
    sys.exit(0)

counts = json.loads(dispatch_file.read_text()) if dispatch_file.exists() else {}
counts[operation_ref] = counts.get(operation_ref, 0) + 1
dispatch_file.write_text(json.dumps(counts))

if mode == "block_before_commit":
    print(json.dumps({"status": "STARTED", "operationRef": operation_ref}), flush=True)
    time.sleep(60)
    sys.exit(0)

out = {
    "status": "COMMITTED",
    "operationRef": operation_ref,
    "resultDigest": "fixture-result-" + operation_ref,
}
receipt.write_text(json.dumps(out))

if mode == "crash_after_commit":
    os._exit(23)

print(json.dumps(out), flush=True)
