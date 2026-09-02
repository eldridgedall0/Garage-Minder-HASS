#!/usr/bin/env bash
#
# One command to cut a release: rebuild, test, bump, tag, push.
#
#   ./scripts/release.sh 0.1.3
#   ./scripts/release.sh 0.1.3 --rebuild ~/src/garageminder
#
# Pushing the tag triggers .github/workflows/release.yml, which builds
# garageminder.zip and publishes the GitHub Release that HACS reads as the
# available version.

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <version> [--rebuild <path-to-garageminder-checkout>]" >&2
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: version must look like 1.2.3, got '$VERSION'" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty. Commit or stash first:" >&2
  git status --short >&2
  exit 1
fi

if [[ "${2:-}" == "--rebuild" ]]; then
  SOURCE="${3:?--rebuild needs the path to a garageminder checkout}"
  echo "==> Rebuilding the frontend bundle from $SOURCE"
  python3 tools/build_frontend.py --source "$SOURCE"
fi

echo "==> Running the test suite"
python3 -m pytest -q

echo "==> Setting manifest version to $VERSION"
python3 - "$VERSION" <<'PY'
import json, pathlib, sys
path = pathlib.Path("custom_components/garageminder/manifest.json")
data = json.loads(path.read_text())
data["version"] = sys.argv[1]
path.write_text(json.dumps(data, indent=2) + "\n")
PY

if [[ -z "$(git status --porcelain)" ]]; then
  echo "==> Nothing changed; tagging the current commit"
else
  git add -A
  git commit -m "Release v$VERSION"
fi

git tag -a "v$VERSION" -m "v$VERSION"
git push origin main --tags

cat <<MSG

Pushed v$VERSION.

  Actions:  https://github.com/eldridgedall0/Garage-Minder-HASS/actions
  Release:  https://github.com/eldridgedall0/Garage-Minder-HASS/releases/tag/v$VERSION

Wait for the release job to finish, then in Home Assistant:
HACS -> GarageMinder -> Update (or Redownload) -> restart.
MSG
