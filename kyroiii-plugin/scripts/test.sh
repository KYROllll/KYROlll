#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CXX="${CXX:-clang++}"
BUILD_DIR="${ROOT}/build/tests"

if ! command -v "${CXX}" >/dev/null 2>&1; then
  echo "error: ${CXX} not found (install the Xcode command line tools)" >&2
  exit 1
fi

mkdir -p "${BUILD_DIR}"

SOURCES=(
  "${ROOT}/tests/meter_core_test.cpp"
  "${ROOT}/src/core/LoudnessMeter.cpp"
  "${ROOT}/src/core/LowEndMeter.cpp"
  "${ROOT}/src/core/CorrelationMeter.cpp"
  "${ROOT}/src/core/DynamicRangeMeter.cpp"
  "${ROOT}/src/core/MeterEngine.cpp"
)

echo "compiling KYROIII meter core tests"
"${CXX}" -std=c++17 -O2 -Wall -Wextra -Wpedantic \
  -I"${ROOT}/src" \
  "${SOURCES[@]}" \
  -o "${BUILD_DIR}/kyroiii_meter_core_test"

echo "running KYROIII meter core tests"
"${BUILD_DIR}/kyroiii_meter_core_test"
