# BUILD ON macOS — AU / VST3 / STANDALONE

Target: **Apple Silicon M1 or newer**, macOS 12+, Logic Pro.

## 1. Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| macOS | 12+ | Deployment target in `CMakeLists.txt` |
| Xcode | 15+ (full IDE) | AU validation, signing, Logic testing |
| Xcode Command Line Tools | matching Xcode | `clang++`, SDK headers |
| CMake | 3.22+ | JUCE CMake integration |
| Internet | first configure | JUCE 8.0.15 is fetched by `FetchContent` |

Install CMake with Homebrew:

```bash
brew install cmake
```

Confirm the developer directory points at a **full Xcode**, not only the command
line tools:

```bash
xcode-select -p
# /Applications/Xcode.app/Contents/Developer

xcodebuild -version
```

If it prints `/Library/Developer/CommandLineTools`, switch it:

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

The command line tools can compile the plug-in and `auval` can validate a
locally built AU. A full Xcode install is still the supported path for Logic Pro
registration, Developer ID signing and notarisation. The build script warns and
continues if `xcodebuild` is unavailable.

## 2. Build

From the repository root:

```bash
cd kyroiii-plugin
bash scripts/build-macos.sh
```

The script:

1. checks macOS, `cmake` and `clang++`;
2. configures `build/macos-arm64` with `CMAKE_BUILD_TYPE=Release` and
   `CMAKE_OSX_ARCHITECTURES=arm64`;
3. fetches JUCE 8.0.15 on the first run (or uses `JUCE_PATH`);
4. builds the AU, VST3 and Standalone targets;
5. runs `ctest` for the core DSP tests;
6. prints the bundle paths.

### Use a local JUCE checkout

```bash
JUCE_PATH="$HOME/src/JUCE" bash scripts/build-macos.sh
```

The checkout must contain the JUCE CMake project (the normal source tree, not a
build tree).

### Universal binary

```bash
KYROIII_ARCH=universal bash scripts/build-macos.sh
```

This builds `arm64;x86_64`. Apple Silicon runs the arm64 slice natively. A
universal build roughly doubles compile time and artifact size.

### CMake presets instead of the script

```bash
cmake --preset macos-arm64
cmake --build --preset macos-arm64
ctest --test-dir build/macos-arm64 --output-on-failure
```

## 3. Outputs

The exact folder can vary slightly with JUCE/CMake versions. Look under
`build/macos-arm64/KyroIIIMasteringMeter_artefacts/Release/`:

```
AU/KYROIII MASTERING METER.component
VST3/KYROIII MASTERING METER.vst3
Standalone/KYROIII MASTERING METER.app
```

The install script finds them by name under the build directory.

Check the architecture:

```bash
lipo -info "build/macos-arm64/KyroIIIMasteringMeter_artefacts/Release/AU/KYROIII MASTERING METER.component/Contents/MacOS/KYROIII MASTERING METER"
# arm64
```

## 4. Install for Logic Pro

```bash
bash scripts/install-macos.sh
```

The script installs:

| Format | Destination |
| --- | --- |
| AU | `~/Library/Audio/Plug-Ins/Components/KYROIII MASTERING METER.component` |
| VST3 | `~/Library/Audio/Plug-Ins/VST3/KYROIII MASTERING METER.vst3` |
| Standalone | `~/Applications/KYROIII MASTERING METER.app` |

It ad-hoc signs each bundle (`codesign --deep --sign -`) and restarts
`AudioComponentRegistrar` so hosts notice the new AU.

Then:

1. Quit Logic Pro completely.
2. Reopen Logic Pro.
3. **Logic Pro → Settings → Plug-in Manager**.
4. Select **Audio Units**, find **KYROIII**, select **KYROIII MASTERING METER**.
5. Click **Reset & Rescan Selection**.
6. Insert it on a master bus: **Audio FX → Audio Units → KYROIII → KYROIII
   MASTERING METER**.

The plug-in is an effect, not an instrument, so it appears under Audio FX.

## 5. AU validation

```bash
auval -v aufx Kmm1 Kyro
```

- `aufx` = effect
- `Kmm1` = `PLUGIN_CODE`
- `Kyro` = `PLUGIN_MANUFACTURER_CODE`

A passing run ends with `AU VALIDATION SUCCEEDED.` If it fails, the first lines
usually identify a missing component, a bad bundle ID or a failed factory
function. Re-run the build and re-install after fixing.

List registered AUs:

```bash
auval -a | grep -i kyro
```

## 6. Signing and distribution

Local testing:

```bash
codesign --force --deep --sign - "path/to/KYROIII MASTERING METER.component"
```

Public distribution needs:

1. a Developer ID Application certificate;
2. hardened runtime + the audio plug-in entitlements;
3. `codesign --options runtime --timestamp`;
4. notarisation (`notarytool submit`) and stapling;
5. a signed `.pkg` installer for both AU and VST3.

None of that is wired in this initial workspace. Ad-hoc signing is enough for
Logic on the build machine.

## 7. Troubleshooting

### `cmake: command not found`

```bash
brew install cmake
# or use a CMake binary from cmake.org and put it on PATH
```

### `xcodebuild: error: tool 'xcodebuild' requires Xcode`

You are pointed at the command line tools. Switch with `xcode-select` (section
1). The build may still compile, but do AU validation on full Xcode.

### JUCE fetch fails or is very slow

The first configure clones ~JUCE 8.0.15. If the network is restricted:

```bash
git clone --depth 1 --branch 8.0.15 https://github.com/juce-framework/JUCE.git ~/src/JUCE
JUCE_PATH="$HOME/src/JUCE" bash scripts/build-macos.sh
```

Do not switch JUCE tags silently; the UI uses the JUCE 8 `FontOptions` API.

### AU does not appear in Logic

```bash
killall -9 AudioComponentRegistrar
auval -a | grep -i kyro
```

Then restart Logic. If `auval` sees it but Logic does not, use the Plug-in
Manager's **Reset & Rescan Selection** rather than a full Logic reinstall.

### `auval` reports a validation error

- Confirm `PLUGIN_CODE Kmm1` and `PLUGIN_MANUFACTURER_CODE Kyro` in
  `CMakeLists.txt`.
- Confirm the bundle is in `~/Library/Audio/Plug-Ins/Components`, not the build
  folder.
- Check `Console.app` for `AudioComponentRegistrar` messages.
- Rebuild with full Xcode and re-install.

### Standalone app opens but no meters move

The Standalone needs an input device. Choose a valid audio input in the app's
audio settings; the meter observes the input buffer and is silent without one.

### Build succeeds but the UI is blank

The editor is fixed at 1100 × 680. Check that `MeterFace` was added and that
`PluginEditor::resized()` sets its bounds. A blank editor is a layout bug; JUCE 8
does not show a licensing splash screen in this build.

## 8. Verification checklist

```bash
bash scripts/verify.sh
bash scripts/build-macos.sh
bash scripts/install-macos.sh
auval -v aufx Kmm1 Kyro
```

Then run the manual Logic checks in [`TESTING.md`](TESTING.md).
