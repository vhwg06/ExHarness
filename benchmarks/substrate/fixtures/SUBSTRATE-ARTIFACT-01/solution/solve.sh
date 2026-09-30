#!/bin/bash
set -euo pipefail
mkdir -p /app/out/nested/a
printf '{"calibration":"nested","items":[1,2,3]}\n' > /app/out/nested/a/data.json
cd /app/out/nested && sha256sum a/data.json > MANIFEST.sha256
