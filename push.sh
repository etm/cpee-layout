#!/bin/sh
# publish the current version from package.json to npm. npm leaves out
# symlinks, and the themes share most of their symbols and rngs with preset
# through them, so publish from a copy with the links resolved. Arguments are
# passed on to npm publish, e.g. ./push.sh --dry-run
set -e
cd "$(dirname "$0")"

BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
cp -rL package.json README.md LICENSE $(node -p "require('./package.json').files.join(' ')") "$BUILD"/

npm whoami > /dev/null 2>&1 || npm login
cd "$BUILD"
npm publish --access public "$@"
