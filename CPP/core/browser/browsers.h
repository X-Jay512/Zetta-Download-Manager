// browsers.h — C++17 port of browsers.js (Windows only)
// Finds installed browsers via StartMenuInternet registry entries and well-known install paths.
#pragma once

#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "util.h"
#include "zdm_str.hpp"

namespace zdm {

struct KnownBrowser {
  std::string id;
  std::wstring name;
  std::vector<std::wstring> paths;  // may contain %ENV% variables
};

struct InstalledBrowser {
  std::string id;
  std::wstring name;
  bool enabled = true;
  std::string family;  // "chromium" or "firefox"
  fs::path exe;
  std::string store;       // "chrome", "firefox" or ""
  std::string storeName;
  std::string storeUrl;

  nlohmann::json toJson() const;
};

inline const char* kChromeStoreUrl() {
  return ZDM_STR("https://chromewebstore.google.com/detail/extension-id");
}
inline const char* kFirefoxStoreUrl() {
  return ZDM_STR("https://addons.mozilla.org/en-US/firefox/addon/zetta-download-manager/");
}

const std::vector<KnownBrowser>& knownBrowsers();

// Scans the registry and known paths. `previous` keeps each browser's "enabled" flag between scans.
// Blocking (runs registry queries); call it from a worker thread.
std::vector<InstalledBrowser> scanInstalledBrowsers(const std::vector<InstalledBrowser>& previous = {});

// Path to a browser's executable by id, or an empty path when it cannot be found.
fs::path getBrowserExe(const std::string& id);

// "firefox", "chromium" or "" depending on the files next to the executable.
std::string familyOf(const fs::path& exe);

// Pulls the .exe path out of a shell command such as: "C:\Program Files\X\x.exe" --flag "%1"
fs::path exeFromCommand(const std::wstring& command);

}  // namespace zdm
