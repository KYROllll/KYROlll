#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="${KYROIII_ARCH:-arm64}"
CMAKE="${CMAKE:-cmake}"
GENERATOR="${KYROIII_GENERATOR:-Unix Makefiles}"
BUILD_DIR="${KYROIII_BUILD_DIR:-${ROOT}/build/macos-${ARCH}}"
JOBS="${KYROIII_JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || echo 8)}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: this build script targets macOS only" >&2
  exit 1
fi

if ! command -v "${CMAKE}" >/dev/null 2>&1; then
  echo "error: cmake not found. Install it with: brew install cmake" >&2
  exit 1
fi

if ! command -v clang++ >/dev/null 2>&1; then
  echo "error: clang++ not found. Install the Xcode command line tools." >&2
  exit 1
fi

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "warning: full Xcode was not detected. Compilation may succeed with the"
  echo "         command line tools, but AU validation and signing are best"
  echo "         verified from a full Xcode installation."
fi

if [[ "${ARCH}" == "universal" ]]; then
  ARCHITECTURES="arm64;x86_64"
  BUILD_DIR="${KYROIII_BUILD_DIR:-${ROOT}/build/macos-universal}"
elif [[ "${ARCH}" == "arm64" || "${ARCH}" == "x86_64" ]]; then
  ARCHITECTURES="${ARCH}"
else
  echo "error: KYROIII_ARCH must be arm64, x86_64 or universal (got '${ARCH}')" >&2
  exit 1
fi

CONFIGURE_ARGS=(
  -S "${ROOT}"
  -B "${BUILD_DIR}"
  -G "${GENERATOR}"
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_OSX_ARCHITECTURES="${ARCHITECTURES}"
  -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0
  -DKYROIII_BUILD_TESTS=ON
)

if [[ -n "${JUCE_PATH:-}" ]]; then
  if [[ ! -d "${JUCE_PATH}" ]]; then
    echo "error: JUCE_PATH does not point to a directory: ${JUCE_PATH}" >&2
    exit 1
  fi
  CONFIGURE_ARGS+=(-DKYROIII_JUCE_PATH="${JUCE_PATH}")
  echo "using local JUCE checkout: ${JUCE_PATH}"
else
  echo "JUCE will be fetched on first configure (pinned tag: 8.0.15)."
  echo "Set JUCE_PATH to use an existing checkout instead."
fi

echo "configuring KYROIII MASTERING METER for ${ARCHITECTURES}"
"${CMAKE}" "${CONFIGURE_ARGS[@]}"

echo "building AU, VST3 and Standalone (${JOBS} jobs)"
"${CMAKE}" --build "${BUILD_DIR}" --config Release --parallel "${JOBS}"

if [[ "${KYROIII_RUN_TESTS:-1}" == "1" ]]; then
  echo "running core tests"
  ctest --test-dir "${BUILD_DIR}" --output-on-failure
fi

echo
echo "artifacts:"
find "${BUILD_DIR}" -maxdepth 8 \
  \( -name "*.component" -o -name "*.vst3" -o -name "KYROIII MASTERING METER.app" \) \
  -print 2>/dev/null | sort || true

echo
echo "next: bash scripts/install-macos.sh"
