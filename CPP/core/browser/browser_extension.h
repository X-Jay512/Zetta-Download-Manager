// browser_extension.h — C++17 port of browser-extension.js (Windows only)
//
// Installs / detects / removes the Zetta Download Manager browser extension.
// All functions are synchronous and may block for several seconds (they wait for the browser),
// so call them from a worker thread, not from your UI thread.
#pragma once

#include <functional>
#include <map>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "crx_pack.h"
#include "util.h"

namespace zdm {

struct BrowserInfo {
  std::string id;
  std::wstring image;      // process image name, e.g. L"chrome.exe"
  std::wstring forcelist;  // HKCU policy key for ExtensionInstallForcelist (empty for Firefox)
  std::wstring sources;    // HKCU policy key for ExtensionInstallSources (empty for Firefox)
  std::wstring native;     // native messaging host registry key
  std::vector<std::wstring> roots;  // profile roots, may contain %ENV% variables
  bool firefox = false;
};

// The BROWSERS table from the Node version, keyed by lowercase id.
const std::map<std::string, BrowserInfo>& browsers();

struct InstallOptions {
  fs::path exe;       // browser executable
  fs::path extDir;    // unpacked extension folder (contains manifest.json)
  fs::path userData;  // app data folder (keys, dist, native manifest)
  std::function<void(const fs::path&)> setDist;  // optional: tell the local server where zdm.crx lives
  std::function<bool()> isConnected;             // optional: custom "extension is connected" check
};

struct InstallResult {
  bool ok = false;
  bool connected = false;
  bool installed = false;
  bool needsRestart = false;
  std::string extensionId;
  std::string stage;
  std::string error;
  nlohmann::json detail;  // null when absent

  nlohmann::json toJson() const;
};

bool extensionInstalled(const std::string& browserId, const std::string& extensionId);
bool extensionKept(const std::string& browserId);
nlohmann::json extensionStatus(const std::string& browserId, const fs::path& extDir);

// Id Chrome assigns to an unpacked extension loaded from `folder`.
std::string unpackedExtensionId(const fs::path& folder);

nlohmann::json describeBrowser(const std::string& browserId, const std::string& extensionId);

InstallResult installExtension(const std::string& browserId, const InstallOptions& opts);
InstallResult removeExtension(const std::string& browserId, const InstallOptions& opts);

// Call this first thing in main()/wWinMain(). When the process was started by the installer
// to write browser policies with administrator rights, it does that work, sets `exitCode`
// and returns true; the caller must then exit immediately with that code.
//
//   int exitCode = 0;
//   if (zdm::handleElevatedPolicyMode(exitCode)) return exitCode;
bool handleElevatedPolicyMode(int& exitCode);

}  // namespace zdm
