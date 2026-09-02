#!/usr/bin/env bash
#
# Copy the integration straight onto the Home Assistant box, skipping GitHub.
# Use this while iterating; use release.sh when a change is ready to publish.
#
#   ./scripts/deploy-to-ha.sh                 # uses HA_HOST below
#   ./scripts/deploy-to-ha.sh root@10.0.0.5

set -euo pipefail

HA_HOST="${1:-root@192.168.1.84}"
cd "$(dirname "$0")/.."

if [[ ! -f custom_components/garageminder/frontend/app/index.html ]]; then
  echo "error: the frontend bundle is missing. Run:" >&2
  echo "  python3 tools/build_frontend.py --source <garageminder checkout>" >&2
  exit 1
fi

echo "==> Copying to $HA_HOST:/config/custom_components/garageminder"
rsync -a --delete \
  custom_components/garageminder/ \
  "$HA_HOST:/config/custom_components/garageminder/"

echo "==> Done. Restart Home Assistant to pick it up:"
echo "    Settings -> System -> top-right menu -> Restart Home Assistant"
