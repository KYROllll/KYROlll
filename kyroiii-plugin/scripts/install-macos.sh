#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${1:-${KYROIII_BUILD_DIR:-${ROOT}/build/macos-arm64}}"

if [[ ! -d "${BUILD_DIR}" ]]; then
  echo "error: build directory not found: ${BUILD_DIR}" >&2
  echo "run: bash scripts/build-macos.sh" >&2
  exit 1
fi

find_one() {
  find "${BUILD_DIR}" -type d -name "$1" -print -quit 2>/dev/null || true
}

AU_SOURCE="$(find_one "KYROIII MASTERING METER.component")"
VST3_SOURCE="$(find_one "KYROIII MASTERING METER.vst3")"
APP_SOURCE="$(find_one "KYROIII MASTERING METER.app")"

if [[ -z "${AU_SOURCE}" && -z "${VST3_SOURCE}" && -z "${APP_SOURCE}" ]]; then
  echo "error: no built KYROIII bundles found under ${BUILD_DIR}" >&2
  echo "run: bash scripts/build-macos.sh" >&2
  exit 1
fi

install_bundle() {
  local source="$1"
  local destination="$2"
  local label="$3"

  rm -rf "${destination}"
  cp -R "${source}" "${destination}"

  if command -v codesign >/dev/null 2>&1; then
    codesign --force --deep --sign - "${destination}" >/dev/null 2>&1 \
      || echo "warning: ad-hoc signing failed for ${label}; local testing may still work"
  fi

  echo "installed ${label}: ${destination}"
}

if [[ -n "${AU_SOURCE}" ]]; then
  AU_DIR="${HOME}/Library/Audio/Plug-Ins/Components"
  mkdir -p "${AU_DIR}"
  install_bundle "${AU_SOURCE}" "${AU_DIR}/KYROIII MASTERING METER.component" "AU"
fi

if [[ -n "${VST3_SOURCE}" ]]; then
  VST3_DIR="${HOME}/Library/Audio/Plug-Ins/VST3"
  mkdir -p "${VST3_DIR}"
  install_bundle "${VST3_SOURCE}" "${VST3_DIR}/KYROIII MASTERING METER.vst3" "VST3"
fi

if [[ -n "${APP_SOURCE}" ]]; then
  APP_DIR="${HOME}/Applications"
  mkdir -p "${APP_DIR}"
  install_bundle "${APP_SOURCE}" "${APP_DIR}/KYROIII MASTERING METER.app" "Standalone"
fi

# Make Logic and other hosts notice a freshly copied AU without a reboot.
killall -9 AudioComponentRegistrar >/dev/null 2>&1 || true

echo
echo "Logic Pro: quit and reopen, then open Logic Pro > Settings > Plug-in Manager"
echo "and rescan Audio Units. The plug-in appears under Manufacturer KYROIII."
echo "Manual validation: auval -v aufx Kmm1 Kyro"

if [[ "${KYROIII_RUN_AUVAL:-0}" == "1" ]] && command -v auval >/dev/null 2>&1; then
  echo
  echo "running auval"
  auval -v aufx Kmm1 Kyro
fi
