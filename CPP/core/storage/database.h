#pragma once
#include "zdm_str.hpp"
// database.js -> Database: downloads.json persistence. Records stay dynamic JSON objects because
// the engine adds fields of its own (progress, speed, ...) that must survive load/save.

#include <optional>
#include <string>
#include <vector>

#include "util.h"

namespace dm {

class Database {
 public:
  explicit Database(const fs::path& userDataDir);  // userDataDir/downloads.json

  Record createDownload(const json& opts);
  void updateDownload(const std::string& id, const json& updates);  // Object.assign semantics
  std::optional<Record> getDownload(const std::string& id) const;   // a copy
  std::vector<Record> getDownloadsByCategory(const std::string& category);
  void removeDownload(const std::string& id);
  std::vector<Record> getAll() const;

 private:
  void load();
  void save() const;
  json& downloads() { return data_[ZDM_STR("downloads")]; }
  const json& downloads() const { return data_.at(ZDM_STR("downloads")); }

  fs::path dbPath_;
  json data_;
};

}  // namespace dm
