# This target is built only by the explicit standalone Link prototype command.
cmake_minimum_required(VERSION 3.24)
project(den_kit_link LANGUAGES CXX)

include(FetchContent)
FetchContent_Declare(den_link
  URL https://codeload.github.com/Ableton/link/tar.gz/5ba907ae027a8c2ec8824463e37296dcefc5e9be
  URL_HASH SHA256=ea920629535f7f9efc0b63e0a7a76b92a2d49d802df6f28fc63790082fe8a360
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  SOURCE_SUBDIR den-kit-no-subproject
)
FetchContent_Declare(den_link_asio
  URL https://codeload.github.com/chriskohlhoff/asio/tar.gz/8806a6803cde7054c3049d3666d3ec36786568c5
  URL_HASH SHA256=ca7f6c14f2bf91e61c7e81fb693f2f8fc86f93e85520d5fc7fd035d0f666bb35
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  SOURCE_SUBDIR den-kit-no-subproject
)
FetchContent_MakeAvailable(den_link den_link_asio)

# The pinned Asio archive is the SDK's submodule, fetched separately so a source
# checkout needs neither recursive Git submodules nor an Electron-native addon.
set(LINK_USE_BUNDLED_ASIO OFF CACHE BOOL "" FORCE)
include(${den_link_SOURCE_DIR}/AbletonLinkConfig.cmake)
set_property(TARGET AsioStandalone::AsioStandalone APPEND PROPERTY
  INTERFACE_INCLUDE_DIRECTORIES ${den_link_asio_SOURCE_DIR}/include)
set_property(TARGET AsioStandalone::AsioStandalone APPEND PROPERTY
  INTERFACE_COMPILE_DEFINITIONS
  ASIO_STANDALONE=1 ASIO_NO_TYPEID=1 ASIO_VERSION_NAMESPACE=den_kit_link_asio)

add_executable(den-kit-link main.cpp)
target_compile_features(den-kit-link PRIVATE cxx_std_17)
target_link_libraries(den-kit-link PRIVATE Ableton::Link)
link_pin_win32_winnt(den-kit-link)
if(WIN32)
  target_link_libraries(den-kit-link PRIVATE ws2_32 iphlpapi)
endif()
set_target_properties(den-kit-link PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/../bin
  RUNTIME_OUTPUT_DIRECTORY_RELEASE ${CMAKE_BINARY_DIR}/../bin)

file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/../licenses)
configure_file(${den_link_SOURCE_DIR}/LICENSE.md
  ${CMAKE_BINARY_DIR}/../licenses/Ableton-Link-LICENSE.md COPYONLY)
configure_file(${den_link_SOURCE_DIR}/GNU-GPL-v2.0.md
  ${CMAKE_BINARY_DIR}/../licenses/Ableton-Link-GPL-v2.0.md COPYONLY)
configure_file(${den_link_asio_SOURCE_DIR}/LICENSE_1_0.txt
  ${CMAKE_BINARY_DIR}/../licenses/Asio-LICENSE.txt COPYONLY)
