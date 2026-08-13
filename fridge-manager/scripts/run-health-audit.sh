#!/usr/bin/env bash
# Профилактический аудит данных (cron: раз в неделю).
#
#   cd fridge-manager && bash scripts/run-health-audit.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Orphan checkins (without fridgeRef) ==="
node scripts/diagnose-orphan-checkins.js --limit 5 --sample 1000

echo ""
echo "=== Orphan fridges (invalid cityId) ==="
node scripts/diagnose-orphan-fridges.js 2>/dev/null || echo "(script optional)"

echo ""
echo "=== Duplicate identifiers across cities ==="
node scripts/diagnose-duplicate-fridge-identifiers.js --limit 5

echo ""
echo "=== Health audit complete ==="
