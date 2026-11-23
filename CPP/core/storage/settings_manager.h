#pragma once
// settings.js -> SettingsManager. Settings stay a dynamic JSON document (ordered_json), so the
// file format, the migrations and update({...}) deep-merges behave exactly like the JS version.

#include <string>
#include <vector>

#include "util.h"

namespace dm {

extern const std::vector<std::string> kDefaultExtensions;  // DEFAULT_EXTENSIONS

class SettingsManager {
 public:
  // `userDataDir` replaces electron's app.getPath('userData'); settings.json lives there.
  explicit SettingsManager(const fs::path& userDataDir);

  const json& getAll() const { return settings_; }
  json get(const std::string& dottedKey) const;  // get('speed.maxConcurrent'); null if missing
  const json& update(const json& updates);       // deep merge + save
  const json& reset();
  const json& restorePart(const std::string& part);
  json extensionSlice() const;

 private:
  fs::path downloadsDir() const;
  json defaults() const;
  void load();
  void save() const;
  bool migrate(const json& saved);
  bool migrateThemeOrder(const json& saved);
  bool migrateKindFolders(const json& saved);
  static json deepMerge(const json& target, const json& source);

  fs::path userData_;
  fs::path settingsPath_;
  json settings_;
};

}  // namespace dm
