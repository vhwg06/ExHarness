#!/bin/bash
# Independent verifier with a scripted crash control: when the calibration control marker exists the
# verifier exits without a reward file, which the substrate must report as VERIFIER_ERROR.
if [ -e /app/control/crash-verifier ]; then
  echo "verifier crashed (scripted control)" >&2
  exit 7
fi
if [ -f /app/out/result.txt ] && [ ! -L /app/out/result.txt ] && [ "$(cat /app/out/result.txt)" = "calibrated" ]; then
  echo "PASS: /app/out/result.txt matches"; echo 1 > /logs/verifier/reward.txt
else
  echo "FAIL: /app/out/result.txt missing or wrong"; echo 0 > /logs/verifier/reward.txt
fi
