#!/usr/bin/env bash
# One-command Linux/WSL build for the Obr host compiler.
# All paths are resolved from this script's directory; no absolute paths.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
preset="linux-gcc"
clean=0
fresh=0
run_tests=1

usage() {
  cat <<'EOF'
Usage: ./build.sh [options]

  --preset <name>   Configure preset (default: linux-gcc)
  --clean           Remove build/<preset> before configuring
  --fresh           Discard CMake cache before configuring
  --no-test         Skip ctest
  -h, --help        Show this help
EOF
}

while (($#)); do
  case "$1" in
    --preset)
      preset="${2:?--preset needs a value}"
      shift 2
      ;;
    --preset=*)
      preset="${1#*=}"
      shift
      ;;
    --clean)
      clean=1
      shift
      ;;
    --fresh)
      fresh=1
      shift
      ;;
    --no-test)
      run_tests=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$preset" in
  linux-gcc) ;;
  *)
    echo "Unsupported preset: $preset" >&2
    exit 2
    ;;
esac

for tool in cmake ninja c++; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Required command not found in PATH: $tool" >&2
    exit 1
  fi
done

cd "$here"

if [[ $clean -eq 1 ]]; then
  rm -rf "build/$preset"
  echo "Removed build/$preset"
fi

configure_args=(--preset "$preset")
if [[ $fresh -eq 1 ]]; then
  configure_args=(--fresh "${configure_args[@]}")
fi

cmake "${configure_args[@]}"
cmake --build --preset "$preset"

if [[ $run_tests -eq 1 ]]; then
  ctest --preset "$preset" --output-on-failure
fi

if [[ ! -f ../Obr/obrc ]]; then
  echo "obrc was not produced at ../Obr/obrc" >&2
  exit 1
fi

printf '\nPreset:  %s\nBuild:   build/%s\nobrc:    ../Obr/obrc\n' "$preset" "$preset"
