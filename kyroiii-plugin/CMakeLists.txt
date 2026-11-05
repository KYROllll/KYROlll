cmake_minimum_required(VERSION 3.22)

project(KYROIIIMasteringMeter VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(APPLE AND NOT CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "12.0" CACHE STRING "Minimum macOS version")
endif()

if(APPLE AND NOT CMAKE_OSX_ARCHITECTURES)
    set(CMAKE_OSX_ARCHITECTURES "arm64" CACHE STRING "macOS architectures")
endif()

option(KYROIII_BUILD_TESTS "Build the dependency-free DSP core tests" ON)
set(KYROIII_JUCE_PATH "" CACHE PATH "Use an existing JUCE checkout instead of fetching it")
set(KYROIII_JUCE_TAG "8.0.15" CACHE STRING "JUCE release tag to fetch")

if(KYROIII_JUCE_PATH)
    add_subdirectory("${KYROIII_JUCE_PATH}" "${CMAKE_BINARY_DIR}/JUCE")
else()
    include(FetchContent)
    FetchContent_Declare(
        JUCE
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG ${KYROIII_JUCE_TAG}
        GIT_SHALLOW TRUE
    )
    FetchContent_MakeAvailable(JUCE)
endif()

juce_add_plugin(KyroIIIMasteringMeter
    COMPANY_NAME "KYROIII"
    COMPANY_EMAIL "SUPPORT@KYROILL.STORE"
    COMPANY_WEBSITE "https://kyroill.store"
    BUNDLE_ID "store.kyroill.masteringmeter"
    PLUGIN_MANUFACTURER_CODE Kyro
    PLUGIN_CODE Kmm1
    PRODUCT_NAME "KYROIII MASTERING METER"
    FORMATS AU VST3 Standalone
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE
    AU_MAIN_TYPE kAudioUnitType_Effect
    VST3_CATEGORIES Fx Analyzer
)

target_sources(KyroIIIMasteringMeter PRIVATE
    src/plugin/PluginProcessor.cpp
    src/ui/PluginEditor.cpp
    src/ui/MeterFace.cpp
    src/ui/DiagnosticWindow.cpp
    src/ui/FlowerLogo.cpp
    src/core/LoudnessMeter.cpp
    src/core/LowEndMeter.cpp
    src/core/CorrelationMeter.cpp
    src/core/DynamicRangeMeter.cpp
    src/core/MeterEngine.cpp
)

target_include_directories(KyroIIIMasteringMeter PRIVATE src)

target_compile_definitions(KyroIIIMasteringMeter PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_REPORT_APP_USAGE=0
    JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(KyroIIIMasteringMeter PRIVATE
    juce::juce_audio_utils
    juce::juce_gui_basics
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags
)

if(KYROIII_BUILD_TESTS)
    enable_testing()

    add_executable(kyroiii_meter_core_test
        tests/meter_core_test.cpp
        src/core/LoudnessMeter.cpp
        src/core/LowEndMeter.cpp
        src/core/CorrelationMeter.cpp
        src/core/DynamicRangeMeter.cpp
        src/core/MeterEngine.cpp
    )

    target_include_directories(kyroiii_meter_core_test PRIVATE src)
    target_compile_features(kyroiii_meter_core_test PRIVATE cxx_std_17)

    if(MSVC)
        target_compile_options(kyroiii_meter_core_test PRIVATE /W4)
    else()
        target_compile_options(kyroiii_meter_core_test PRIVATE -Wall -Wextra -Wpedantic)
    endif()

    add_test(NAME kyroiii_meter_core COMMAND kyroiii_meter_core_test)
endif()
