#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.."

DIST_CHANNEL_FILE="src/lib/dist-channel.ts"
DIST_CHANNEL_BACKUP="$(mktemp)"
cp "$DIST_CHANNEL_FILE" "$DIST_CHANNEL_BACKUP"

restore() {
  cp "$DIST_CHANNEL_BACKUP" "$DIST_CHANNEL_FILE"
  rm -f "$DIST_CHANNEL_BACKUP"
}
trap restore EXIT

cat > "$DIST_CHANNEL_FILE" <<'EOF'
export const DIST_CHANNEL: 'npm' | 'binary' = 'binary'
EOF

mkdir -p release-binaries

# name : bun --compile --target value
declare -A TARGETS=(
  [actovia-darwin-arm64]=bun-darwin-arm64
  [actovia-darwin-x64]=bun-darwin-x64
  [actovia-linux-arm64]=bun-linux-arm64
  [actovia-linux-x64]=bun-linux-x64
  [actovia-windows-x64.exe]=bun-windows-x64
)

failed=()
for name in "${!TARGETS[@]}"; do
  target="${TARGETS[$name]}"
  echo "Building $name ($target)..."
  if ! bun build --compile --target="$target" --outfile "release-binaries/$name" ./index.ts; then
    echo "FAILED: $name" >&2
    failed+=("$name")
  fi
done

echo "Built:"
ls -la release-binaries

if [ ${#failed[@]} -gt 0 ]; then
  echo "The following targets failed to build: ${failed[*]}" >&2
  exit 1
fi
