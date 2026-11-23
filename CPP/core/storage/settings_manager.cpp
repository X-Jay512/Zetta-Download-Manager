#include "zdm_str.hpp"
#include "settings_manager.h"

#include <cmath>
#include <fstream>
#include <map>
#include <sstream>
#include <stdexcept>

namespace dm {

const std::vector<std::string> kDefaultExtensions = {
    "3gp", "7z",   ZDM_STR("aac"),  ZDM_STR("ace"),  ZDM_STR("aif"),  ZDM_STR("apk"),  ZDM_STR("arj"),  ZDM_STR("asf"),  ZDM_STR("avi"),  ZDM_STR("bin"),  ZDM_STR("bz2"),
    ZDM_STR("exe"), ZDM_STR("flv"),  "gz",   ZDM_STR("gzip"), ZDM_STR("img"),  ZDM_STR("iso"),  ZDM_STR("lzh"),  ZDM_STR("m4a"),  ZDM_STR("m4v"),  ZDM_STR("mkv"),  ZDM_STR("mov"),
    ZDM_STR("mp3"), ZDM_STR("mp4"),  ZDM_STR("mpa"),  ZDM_STR("mpe"),  ZDM_STR("mpeg"), ZDM_STR("mpg"),  ZDM_STR("msi"),  ZDM_STR("msu"),  ZDM_STR("ogg"),  ZDM_STR("ogv"),  ZDM_STR("pdf"),
    ZDM_STR("ppt"), ZDM_STR("pptx"), ZDM_STR("plj"),  ZDM_STR("pps"),  "qt",   "ra",   ZDM_STR("rar"),  "rm",   ZDM_STR("rmvb"), ZDM_STR("sea"),  ZDM_STR("sit"),
    ZDM_STR("sitx"), ZDM_STR("tar"), ZDM_STR("tif"),  ZDM_STR("tiff"), ZDM_STR("wav"),  ZDM_STR("webm"), ZDM_STR("wma"),  ZDM_STR("wmv"),  "z",    ZDM_STR("zip"),  "xz",
    ZDM_STR("dmg"), ZDM_STR("deb"),  ZDM_STR("rpm"),  ZDM_STR("doc"),  ZDM_STR("docx"), ZDM_STR("xls"),  ZDM_STR("xlsx")};

namespace {

// The static part of _defaults(). Paths that depend on the machine are filled in afterwards.
const char* const kDefaultsJson = ZDM_STR(R"JSON({
  "appearance": { "theme": "theme1", "columnLines": false, "iconSaturation": 100, "themeRevision": 2 },
  "launch": {
    "startWithWindows": false, "startMinimized": false, "showNotifications": true,
    "watchClipboard": false, "keepAwake": true
  },
  "catch": {
    "interceptDownloads": true, "sniffVideos": true,
    "skipKeysEnabled": true,
    "skipKeys": { "alt": false, "shift": false, "ctrl": false, "del": true },
    "forceKeysEnabled": false,
    "forceKeys": { "alt": false, "shift": false, "ctrl": false, "ins": false },
    "contextDownload": true, "contextDownloadAll": false,
    "hudEnabled": true, "hudMode": "full", "hudMinSizeKB": 50,
    "autoCatchFromPlayers": true, "silentDownload": false, "addSilently": false,
    "startCaptured": false, "minCaptureKB": 0, "detected": [],
    "advancedIntegration": true, "forceNeedsClick": false, "sparePagesWhileKey": true,
    "browsers": { "chrome": true, "brave": true, "edge": true, "firefox": true, "opera": true, "safari": true }
  },
  "types": {
    "extensions": [],
    "skipSites": [
      "*.update.microsoft.com", "download.windowsupdate.com", "*.download.windowsupdate.com",
      "siteseal.thawte.com", "ecom.cimet2.com", "*.voice2page.com"
    ],
    "skipAddresses": []
  },
  "library": {
    "defaultPath": "", "rememberLastFolder": true, "lastFolder": "", "useServerFileTime": false,
    "removeMissing": false, "tempPath": "", "folders": {}
  },
  "behavior": {
    "confirmBeforeStart": true, "showCompleteDialog": true, "startWhileDialog": true,
    "queueOnLater": true, "confirmDelete": true, "cancelAsk": true, "cancelAction": "keep",
    "ignoreMtime": false, "ignoreSsl": false, "retryFailed": false, "retryCount": 3,
    "duplicateAction": "ask", "hlsPull": "native",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
  },
  "speed": {
    "connectionsPerFile": 8, "maxConcurrent": 0, "throttleEnabled": false, "throttleValue": 1,
    "throttleUnit": "MB", "limitEnabled": false, "limitMB": 200, "limitHours": 5,
    "warnBeforeStop": true, "exceptions": []
  },
  "schedule": { "enabled": false, "days": [0, 1, 2, 3, 4, 5, 6], "start": "00:00", "end": "23:59" },
  "proxy": { "enabled": false, "mode": "off", "type": "http", "host": "", "port": 0, "username": "", "password": "" },
  "recentAddresses": [],
  "list": { "sortCol": null, "sortAsc": true },
  "categories": {
    "compressed": [".zip", ".rar", ".7z", ".tar", ".gz", ".bz2"],
    "documents": [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt"],
    "music": [".mp3", ".flac", ".wav", ".aac", ".ogg", ".wma"],
    "video": [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm"],
    "programs": [".exe", ".msi", ".dmg", ".deb", ".rpm", ".appimage"],
    "images": [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp"],
    "patterns": { "compressed": [], "documents": [], "music": [], "programs": [], "video": [], "images": [] }
  }
})JSON");

// kind -> sub-folder of Downloads
const std::vector<std::pair<std::string, std::string>> kKindFolders = {
    {ZDM_STR("compressed"), ZDM_STR("Compressed")}, {ZDM_STR("documents"), ZDM_STR("Documents")}, {ZDM_STR("music"), ZDM_STR("Sounds")},
    {ZDM_STR("programs"), ZDM_STR("Programs")},     {ZDM_STR("video"), ZDM_STR("Video")},         {ZDM_STR("images"), ZDM_STR("Images")}};

std::string normalizePath(const std::string& p) {
  return pathToUtf8(pathFromUtf8(p).lexically_normal().make_preferred());
}

bool endsWithArchivesDir(const std::string& lowered) {  // /[\\/]archives$/i
  static const std::string tail = ZDM_STR("archives");
  if (lowered.size() < tail.size() + 1) return false;
  const char sep = lowered[lowered.size() - tail.size() - 1];
  return (sep == '/' || sep == '\\') && lowered.compare(lowered.size() - tail.size(), tail.size(), tail) == 0;
}

}  // namespace

SettingsManager::SettingsManager(const fs::path& userDataDir)
    : userData_(userDataDir), settingsPath_(userDataDir / ZDM_STR("settings.json")) {
  settings_ = defaults();
  load();
}

fs::path SettingsManager::downloadsDir() const { return homeDir() / ZDM_STR("Downloads"); }

json SettingsManager::defaults() const {
  json j = json::parse(kDefaultsJson);
  const std::string downloads = pathToUtf8(downloadsDir());

  j[ZDM_STR("types")][ZDM_STR("extensions")] = kDefaultExtensions;
  json& lib = j[ZDM_STR("library")];
  lib[ZDM_STR("defaultPath")] = downloads;
  lib[ZDM_STR("tempPath")] = pathToUtf8(userData_ / ZDM_STR("staging"));
  lib[ZDM_STR("folders")] = json::object();
  lib[ZDM_STR("folders")][ZDM_STR("general")] = downloads;
  for (const auto& kv : kKindFolders) lib[ZDM_STR("folders")][kv.first] = pathToUtf8(downloadsDir() / kv.second);
  return j;
}

// ---------------------------------------------------------------- load / save
void SettingsManager::load() {
  try {
    if (!fs::exists(settingsPath_)) return;
    std::ifstream in(settingsPath_, std::ios::binary);
    std::stringstream buffer;
    buffer << in.rdbuf();
    const json saved = json::parse(buffer.str());
    if (!saved.is_object()) return;

    settings_ = deepMerge(defaults(), saved);
    const bool migrated = migrate(saved);
    const bool folders = migrateKindFolders(saved);
    const bool themes = migrateThemeOrder(saved);
    if (migrated || folders || themes) save();
  } catch (...) {
    // use defaults
  }
}

void SettingsManager::save() const {
  std::error_code ec;
  fs::create_directories(settingsPath_.parent_path(), ec);
  std::ofstream out(settingsPath_, std::ios::binary | std::ios::trunc);
  if (!out) throw std::runtime_error("cannot write " + pathToUtf8(settingsPath_));
  out << settings_.dump(2, ' ', false, json::error_handler_t::replace);
}

// ----------------------------------------------------------------- migrations
bool SettingsManager::migrate(const json& saved) {
  bool changed = false;

  const json g = member(saved, ZDM_STR("general"));  // pre-redesign layout
  if (truthy(g)) {
    auto present = [&](const char* k) { return g.is_object() && g.contains(k) && !g.at(k).is_null(); };
    if (present(ZDM_STR("launchOnStartup"))) settings_[ZDM_STR("launch")][ZDM_STR("startWithWindows")] = g.at(ZDM_STR("launchOnStartup"));
    if (present(ZDM_STR("startMinimized"))) settings_[ZDM_STR("launch")][ZDM_STR("startMinimized")] = g.at(ZDM_STR("startMinimized"));
    if (present(ZDM_STR("showNotifications"))) settings_[ZDM_STR("launch")][ZDM_STR("showNotifications")] = g.at(ZDM_STR("showNotifications"));
    if (present(ZDM_STR("clipboardMonitor"))) settings_[ZDM_STR("launch")][ZDM_STR("watchClipboard")] = g.at(ZDM_STR("clipboardMonitor"));
    if (truthy(member(g, ZDM_STR("defaultSavePath")))) settings_[ZDM_STR("library")][ZDM_STR("defaultPath")] = g.at(ZDM_STR("defaultSavePath"));
    if (truthy(member(g, ZDM_STR("maxConcurrentDownloads")))) settings_[ZDM_STR("speed")][ZDM_STR("maxConcurrent")] = g.at(ZDM_STR("maxConcurrentDownloads"));
    if (truthy(member(g, ZDM_STR("segmentsPerFile")))) settings_[ZDM_STR("speed")][ZDM_STR("connectionsPerFile")] = g.at(ZDM_STR("segmentsPerFile"));
  }

  if (!truthy(member(settings_[ZDM_STR("catch")], ZDM_STR("silentDefaultFixed")))) {
    settings_[ZDM_STR("catch")][ZDM_STR("addSilently")] = false;
    settings_[ZDM_STR("catch")][ZDM_STR("advancedIntegration")] = true;
    settings_[ZDM_STR("catch")][ZDM_STR("silentDefaultFixed")] = true;
    changed = true;
  }

  const json proxy = member(saved, ZDM_STR("proxy"));
  if (truthy(proxy) && truthy(member(proxy, ZDM_STR("enabled"))) && !truthy(member(proxy, ZDM_STR("mode")))) {
    settings_[ZDM_STR("proxy")][ZDM_STR("mode")] = ZDM_STR("manual");
    changed = true;
  }

  const json speed = member(saved, ZDM_STR("speed"));
  if (truthy(speed) && truthy(member(speed, ZDM_STR("limitKBps"))) && !truthy(member(speed, ZDM_STR("throttleEnabled")))) {
    const double kb = toNumber(speed.at(ZDM_STR("limitKBps")));
    settings_[ZDM_STR("speed")][ZDM_STR("throttleEnabled")] = true;
    if (kb >= 1024) {
      settings_[ZDM_STR("speed")][ZDM_STR("throttleValue")] = numberJson(kb / 1024);
      settings_[ZDM_STR("speed")][ZDM_STR("throttleUnit")] = "MB";
    } else {
      settings_[ZDM_STR("speed")][ZDM_STR("throttleValue")] = numberJson(kb);
      settings_[ZDM_STR("speed")][ZDM_STR("throttleUnit")] = "KB";
    }
  }

  const json sites = member(member(saved, ZDM_STR("types")), ZDM_STR("skipSites"));
  static const std::vector<std::string> legacySites = {
      "*.update.microsoft.com", "download.windowsupdate.com", "*.download.windowsupdate.com"};
  if (sites.is_array() && sites.size() == legacySites.size()) {
    bool same = true;
    for (std::size_t i = 0; i < legacySites.size(); ++i) {
      if (!sites[i].is_string() || sites[i].get<std::string>() != legacySites[i]) same = false;
    }
    if (same) {
      settings_[ZDM_STR("types")][ZDM_STR("skipSites")] = defaults()[ZDM_STR("types")][ZDM_STR("skipSites")];
      changed = true;
    }
  }
  return changed;
}

bool SettingsManager::migrateThemeOrder(const json& saved) {
  json appearance = member(saved, ZDM_STR("appearance"));
  if (!truthy(appearance)) appearance = json::object();
  const json revision = member(appearance, ZDM_STR("themeRevision"));
  if (revision.is_number() && revision.get<double>() == 2) return false;

  static const std::map<std::string, std::string> order = {
      {ZDM_STR("theme1"), ZDM_STR("theme3")}, {ZDM_STR("theme2"), ZDM_STR("theme1")}, {ZDM_STR("theme3"), ZDM_STR("theme2")}};
  const json theme = member(appearance, ZDM_STR("theme"));
  if (theme.is_string()) {
    auto it = order.find(theme.get<std::string>());
    if (it != order.end()) settings_[ZDM_STR("appearance")][ZDM_STR("theme")] = it->second;
  }
  settings_[ZDM_STR("appearance")][ZDM_STR("themeRevision")] = 2;
  return true;
}

bool SettingsManager::migrateKindFolders(const json& saved) {
  const std::string downloads = toLower(normalizePath(pathToUtf8(downloadsDir())));
  json oldSaved = member(member(saved, ZDM_STR("library")), ZDM_STR("folders"));
  if (!truthy(oldSaved)) oldSaved = json::object();

  bool changed = false;
  for (const auto& kv : kKindFolders) {
    const json value = member(oldSaved, kv.first);
    const std::string current = (truthy(value) && value.is_string())
                                    ? toLower(normalizePath(value.get<std::string>()))
                                    : std::string();
    if (current.empty() || current == downloads || endsWithArchivesDir(current)) {
      settings_[ZDM_STR("library")][ZDM_STR("folders")][kv.first] = pathToUtf8(downloadsDir() / kv.second);
      changed = true;
    }
  }
  return changed;
}

// ------------------------------------------------------------------- merging
json SettingsManager::deepMerge(const json& target, const json& source) {
  json output = target.is_object() ? target : json::object();
  if (!source.is_object()) return output;
  for (auto it = source.begin(); it != source.end(); ++it) {
    if (it.value().is_object()) {
      const json base = output.contains(it.key()) ? output[it.key()] : json::object();
      output[it.key()] = deepMerge(base, it.value());
    } else {
      output[it.key()] = it.value();  // scalars, null and arrays replace
    }
  }
  return output;
}

// ----------------------------------------------------------------- public API
json SettingsManager::get(const std::string& key) const {
  const json* cur = &settings_;
  std::size_t start = 0;
  for (;;) {
    const std::size_t dot = key.find('.', start);
    const std::string part = key.substr(start, dot == std::string::npos ? std::string::npos : dot - start);
    if (cur->is_object()) {
      auto it = cur->find(part);
      if (it == cur->end()) return json();
      cur = &*it;
    } else if (cur->is_array() && !part.empty() && part.find_first_not_of("0123456789") == std::string::npos) {
      const std::size_t idx = std::stoul(part);
      if (idx >= cur->size()) return json();
      cur = &(*cur)[idx];
    } else {
      return json();
    }
    if (dot == std::string::npos) break;
    start = dot + 1;
  }
  return *cur;
}

const json& SettingsManager::update(const json& updates) {
  settings_ = deepMerge(settings_, updates);
  save();
  return settings_;
}

const json& SettingsManager::reset() {
  settings_ = defaults();
  save();
  return settings_;
}

const json& SettingsManager::restorePart(const std::string& part) {
  const json fresh = defaults();
  static const std::map<std::string, std::string> paneMap = {
      {ZDM_STR("launch"), ZDM_STR("launch")}, {ZDM_STR("catch"), ZDM_STR("catch")}, {ZDM_STR("library"), ZDM_STR("library")},
      {ZDM_STR("behavior"), ZDM_STR("behavior")}, {ZDM_STR("speed"), ZDM_STR("speed")}, {ZDM_STR("proxy"), ZDM_STR("proxy")}};

  if (part == ZDM_STR("look")) {
    const json current = member(member(settings_, ZDM_STR("appearance")), ZDM_STR("theme"));
    settings_[ZDM_STR("appearance")] = fresh[ZDM_STR("appearance")];
    settings_[ZDM_STR("appearance")][ZDM_STR("theme")] = truthy(current) ? current : json(ZDM_STR("theme1"));
  } else if (paneMap.count(part)) {
    const std::string& key = paneMap.at(part);
    settings_[key] = fresh[key];
  } else if (part == ZDM_STR("extensions")) {
    settings_[ZDM_STR("types")][ZDM_STR("extensions")] = fresh[ZDM_STR("types")][ZDM_STR("extensions")];
  } else if (part == ZDM_STR("skipSites")) {
    settings_[ZDM_STR("types")][ZDM_STR("skipSites")] = fresh[ZDM_STR("types")][ZDM_STR("skipSites")];
  } else {
    return settings_;  // unknown part: nothing changes, nothing is saved
  }
  save();
  return settings_;
}

json SettingsManager::extensionSlice() const {
  json slice = json::object();
  slice[ZDM_STR("catch")] = settings_.at(ZDM_STR("catch"));
  slice[ZDM_STR("types")] = settings_.at(ZDM_STR("types"));
  slice[ZDM_STR("categories")] = json::object();
  slice[ZDM_STR("categories")][ZDM_STR("patterns")] = settings_.at(ZDM_STR("categories")).at(ZDM_STR("patterns"));
  slice[ZDM_STR("behavior")] = json::object();
  slice[ZDM_STR("behavior")][ZDM_STR("hlsPull")] = ZDM_STR("native");
  return slice;
}

}  // namespace dm
