#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "VERIFY FAILED: $*" >&2
  exit 1
}

require_file() {
  [[ -f "${ROOT}/$1" ]] || fail "missing ${1}"
}

echo "checking workspace layout"
for file in \
  CMakeLists.txt \
  CMakePresets.json \
  README.md \
  AGENTS.md \
  VERSION \
  src/core/MeterEngine.h \
  src/core/MeterEngine.cpp \
  src/core/MeterTypes.h \
  src/plugin/PluginProcessor.h \
  src/plugin/PluginProcessor.cpp \
  src/ui/PluginEditor.h \
  src/ui/PluginEditor.cpp \
  src/ui/MeterFace.h \
  src/ui/MeterFace.cpp \
  src/ui/DiagnosticWindow.h \
  src/ui/DiagnosticWindow.cpp \
  src/ui/FlowerLogo.h \
  src/ui/FlowerLogo.cpp \
  src/ui/KyroTheme.h \
  tests/meter_core_test.cpp \
  preview/index.html \
  preview/style.css \
  preview/ui.js \
  preview/flower.svg \
  docs/ARCHITECTURE.md \
  docs/BRAND-UI.md \
  docs/BUILD-MACOS.md \
  docs/TESTING.md; do
  require_file "${file}"
done

echo "checking shell scripts parse"
for script in build-macos.sh install-macos.sh test.sh verify.sh; do
  bash -n "${ROOT}/scripts/${script}" || fail "scripts/${script} has a syntax error"
done

echo "checking CMake preset JSON"
python3 -m json.tool "${ROOT}/CMakePresets.json" >/dev/null || fail "CMakePresets.json is invalid"

echo "checking AU/VST3 build contract"
grep -q "FORMATS AU VST3 Standalone" "${ROOT}/CMakeLists.txt" \
  || fail "CMakeLists.txt no longer builds AU, VST3 and Standalone"
grep -q "PLUGIN_CODE Kmm1" "${ROOT}/CMakeLists.txt" \
  || fail "CMakeLists.txt lost the Kmm1 plugin code"
grep -q "AU_MAIN_TYPE kAudioUnitType_Effect" "${ROOT}/CMakeLists.txt" \
  || fail "CMakeLists.txt lost the AU effect type"

echo "checking brand tokens"
grep -q "0xff0a0a0a" "${ROOT}/src/ui/KyroTheme.h" || fail "matte black token missing"
grep -q "0xffd4af37" "${ROOT}/src/ui/KyroTheme.h" || fail "gold token missing"
grep -q "0xff6b4a2e" "${ROOT}/src/ui/KyroTheme.h" || fail "brown token missing"
grep -q "0xffe5c158" "${ROOT}/src/ui/KyroTheme.h" || fail "bright gold token missing"
grep -q "0xff6fe08a" "${ROOT}/src/ui/KyroTheme.h" || fail "traffic-light green missing"
grep -q "0xffff5c4d" "${ROOT}/src/ui/KyroTheme.h" || fail "traffic-light red missing"
grep -qi "#0a0a0a" "${ROOT}/preview/style.css" || fail "preview lost the matte black field"
grep -qi "#d4af37" "${ROOT}/preview/style.css" || fail "preview lost the gold accent"
grep -q "LOW-END WEIGHT" "${ROOT}/src/ui/MeterFace.cpp" || fail "low-end window missing"
grep -q "STEREO CORRELATION" "${ROOT}/src/ui/MeterFace.cpp" || fail "correlation window missing"
grep -q "LUFS METERING" "${ROOT}/src/ui/MeterFace.cpp" || fail "LUFS window missing"
grep -q "DYNAMIC RANGE" "${ROOT}/src/ui/MeterFace.cpp" || fail "dynamic-range window missing"
for label in "LOW-END WEIGHT" "STEREO CORRELATION" "LUFS METERING" "DYNAMIC RANGE"; do
  grep -q "${label}" "${ROOT}/preview/index.html" || fail "preview is missing ${label}"
done
grep -q "id=\"flower\"" "${ROOT}/preview/index.html" || fail "preview flower hook missing"

echo "checking documentation links"
grep -q "scripts/build-macos.sh" "${ROOT}/README.md" || fail "README lacks the build command"
grep -q "scripts/test.sh" "${ROOT}/AGENTS.md" || fail "AGENTS lacks the test command"
grep -q "Apple Silicon" "${ROOT}/docs/BUILD-MACOS.md" || fail "macOS build doc lacks Apple Silicon guidance"

echo "running dependency-free DSP tests"
bash "${ROOT}/scripts/test.sh"

echo
echo "KYROIII VERIFY OK"
