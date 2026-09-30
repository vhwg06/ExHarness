#!/bin/bash
# Independent verifier: checks nested content and the candidate's own digest manifest.
cd /app/out/nested 2>/dev/null || { echo "FAIL: no nested artifact"; echo 0 > /logs/verifier/reward.txt; exit 0; }
if [ "$(cat a/data.json 2>/dev/null)" = '{"calibration":"nested","items":[1,2,3]}' ] && sha256sum -c MANIFEST.sha256; then
  echo "PASS: nested artifact and manifest verified"; echo 1 > /logs/verifier/reward.txt
else
  echo "FAIL: nested artifact or manifest mismatch"; echo 0 > /logs/verifier/reward.txt
fi
