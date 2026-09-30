#!/bin/bash
# Independent verifier: reads only the candidate file, never producer status.
if [ -f /app/out/result.txt ] && [ ! -L /app/out/result.txt ] && [ "$(cat /app/out/result.txt)" = "calibrated" ]; then
  echo "PASS: /app/out/result.txt matches"; echo 1 > /logs/verifier/reward.txt
else
  echo "FAIL: /app/out/result.txt missing or wrong"; echo 0 > /logs/verifier/reward.txt
fi
