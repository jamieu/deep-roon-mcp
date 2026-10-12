#!/bin/bash
# Deep Roon MCP — a release: build, bundle, and a GitHub release with the .mcpb and the notes. npm comes after, by hand
# (it asks for the one-time code). Run from a clean main that's pushed.
#   ./release.sh
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(node -p 'require("./package.json").version')
NOTES="notes/$VERSION.md"
[ -f "$NOTES" ] || { echo "no $NOTES"; exit 1; }
[ "$(git branch --show-current)" = main ] || { echo "not on main"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "uncommitted changes"; exit 1; }
git fetch -q origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main isn't pushed (or is behind)"; exit 1; }
gh release view "v$VERSION" >/dev/null 2>&1 && { echo "v$VERSION is out already"; exit 1; }

npm run -s check
node scripts/build.mjs
node scripts/bundle.mjs
MCPB="dist/deep-roon-mcp-$VERSION.mcpb"
gh release create "v$VERSION" "$MCPB" --title "Deep Roon MCP $VERSION" --notes-file "$NOTES"
echo
echo "Released v$VERSION with $MCPB."
echo "Now npm (asks for your one-time code):  npm publish --access public"
