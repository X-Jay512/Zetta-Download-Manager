#include "zdm_str.hpp"
#include "database.h"

#include <cmath>
#include <fstream>
#include <sstream>
#include <stdexcept>

namespace dm {

namespace {
// `opts.key || fallback`
json orDefault(const json& opts, const char* key, const json& fallback) {
  const json v = member(opts, key);
  return truthy(v) ? v : fallback;
}
// `Number(opts.key) || 0`
json numberOrZero(const json& opts, const char* key) {
  const double n = toNumber(member(opts, key));
  return (std::isnan(n) || n == 0) ? json(0) : numberJson(n);
}
bool asBool(const json& opts, const char* key) { return truthy(member(opts, key)); }  // !!opts.key
}  // namespace

Database::Database(const fs::path& userDataDir)
    : dbPath_(userDataDir / ZDM_STR("downloads.json")), data_(json::object()) {
  data_[ZDM_STR("downloads")] = json::array();
  load();
}

void Database::load() {
  try {
    if (!fs::exists(dbPath_)) return;
    std::ifstream in(dbPath_, std::ios::binary);
    std::stringstream buffer;
    buffer << in.rdbuf();
    json parsed = json::parse(buffer.str());
    if (parsed.is_object()) data_ = std::move(parsed);
    if (!data_.contains(ZDM_STR("downloads")) || !data_[ZDM_STR("downloads")].is_array()) data_[ZDM_STR("downloads")] = json::array();
  } catch (...) {
    data_ = json::object();
    data_[ZDM_STR("downloads")] = json::array();
  }
}

void Database::save() const {
  std::error_code ec;
  fs::create_directories(dbPath_.parent_path(), ec);
  std::ofstream out(dbPath_, std::ios::binary | std::ios::trunc);
  if (!out) throw std::runtime_error("cannot write " + pathToUtf8(dbPath_));
  out << data_.dump(2, ' ', false, json::error_handler_t::replace);
}

Record Database::createDownload(const json& opts) {
  const std::string now = isoNow();
  Record r = json::object();
  r["id"] = orDefault(opts, "id", generateUuid());
  r[ZDM_STR("url")] = member(opts, ZDM_STR("url"));
  r[ZDM_STR("audioUrl")] = orDefault(opts, ZDM_STR("audioUrl"), json());
  r[ZDM_STR("fileName")] = orDefault(opts, ZDM_STR("fileName"), "");
  r[ZDM_STR("savePath")] = orDefault(opts, ZDM_STR("savePath"), "");
  r[ZDM_STR("fileSize")] = orDefault(opts, ZDM_STR("fileSize"), 0);
  r[ZDM_STR("audioSize")] = numberOrZero(opts, ZDM_STR("audioSize"));
  r[ZDM_STR("duration")] = numberOrZero(opts, ZDM_STR("duration"));
  r[ZDM_STR("segments")] = orDefault(opts, ZDM_STR("segments"), 8);
  r[ZDM_STR("headers")] = orDefault(opts, ZDM_STR("headers"), json::object());
  r[ZDM_STR("referrer")] = orDefault(opts, ZDM_STR("referrer"), "");
  r[ZDM_STR("sourcePage")] = orDefault(opts, ZDM_STR("sourcePage"), "");
  r[ZDM_STR("playlistUrl")] = orDefault(opts, ZDM_STR("playlistUrl"), "");
  r[ZDM_STR("formatId")] = orDefault(opts, ZDM_STR("formatId"), "");
  r[ZDM_STR("audioFormatId")] = orDefault(opts, ZDM_STR("audioFormatId"), "");
  r[ZDM_STR("needsRefresh")] = asBool(opts, ZDM_STR("needsRefresh"));
  r[ZDM_STR("login")] = orDefault(opts, ZDM_STR("login"), "");
  r[ZDM_STR("password")] = orDefault(opts, ZDM_STR("password"), "");
  r[ZDM_STR("cookies")] = orDefault(opts, ZDM_STR("cookies"), "");
  r[ZDM_STR("exactHeaders")] = asBool(opts, ZDM_STR("exactHeaders"));
  r[ZDM_STR("tempPath")] = orDefault(opts, ZDM_STR("tempPath"), "");
  r[ZDM_STR("category")] = orDefault(opts, ZDM_STR("category"), ZDM_STR("general"));
  r[ZDM_STR("audioOnly")] = asBool(opts, ZDM_STR("audioOnly"));
  r[ZDM_STR("description")] = orDefault(opts, ZDM_STR("description"), "");
  r[ZDM_STR("checksum")] = orDefault(opts, ZDM_STR("checksum"), "");
  r[ZDM_STR("status")] = ZDM_STR("queued");
  r[ZDM_STR("createdAt")] = now;
  r[ZDM_STR("lastTriedAt")] = now;
  r[ZDM_STR("completedAt")] = nullptr;
  r[ZDM_STR("error")] = nullptr;

  downloads().push_back(r);
  save();
  return r;
}

void Database::updateDownload(const std::string& id, const json& updates) {
  for (auto& d : downloads()) {
    if (stringOr(member(d, "id")) != id) continue;
    if (updates.is_object()) {
      for (auto it = updates.begin(); it != updates.end(); ++it) d[it.key()] = it.value();
    }
    save();
    return;
  }
}

std::optional<Record> Database::getDownload(const std::string& id) const {
  for (const auto& d : downloads()) {
    if (stringOr(member(d, "id")) == id) return d;
  }
  return std::nullopt;
}

std::vector<Record> Database::getDownloadsByCategory(const std::string& category) {
  std::vector<Record> list;
  for (auto& d : downloads()) {
    const std::string status = stringOr(member(d, ZDM_STR("status")));
    bool match = false;
    if (category == ZDM_STR("all")) match = true;
    else if (category == ZDM_STR("unfinished")) match = status != ZDM_STR("complete");
    else if (category == ZDM_STR("finished")) match = status == ZDM_STR("complete");
    else match = stringOr(member(d, ZDM_STR("category"))) == category;
    if (!match) continue;

    // Same side effect as the JS: completed records without a `path` get one filled in.
    if (status == ZDM_STR("complete") && !truthy(member(d, ZDM_STR("path")))) {
      const json savePath = member(d, ZDM_STR("savePath"));
      const json fileName = member(d, ZDM_STR("fileName"));
      const std::string dir = truthy(savePath) ? stringOr(savePath) : pathToUtf8(homeDir());
      const std::string file = truthy(fileName) ? stringOr(fileName) : ZDM_STR("download");
      d[ZDM_STR("path")] = joinPath(dir, file);
    }
    list.push_back(d);
  }
  return list;
}

void Database::removeDownload(const std::string& id) {
  json kept = json::array();
  for (const auto& d : downloads()) {
    if (stringOr(member(d, "id")) != id) kept.push_back(d);
  }
  data_[ZDM_STR("downloads")] = std::move(kept);
  save();
}

std::vector<Record> Database::getAll() const {
  return std::vector<Record>(downloads().begin(), downloads().end());
}

}  // namespace dm
