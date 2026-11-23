#include "zdm_str.hpp"
#include "category_manager.h"

#include <algorithm>
#include <cctype>

namespace dm {

namespace {

bool isSchemeChar(char c, bool first) {
  const unsigned char u = static_cast<unsigned char>(c);
  if (std::isalpha(u)) return true;
  return !first && (std::isdigit(u) || c == '+' || c == '-' || c == '.');
}

bool isValidScheme(const std::string& s) {
  if (s.empty()) return false;
  for (std::size_t i = 0; i < s.size(); ++i) {
    if (!isSchemeChar(s[i], i == 0)) return false;
  }
  return true;
}

// new URL(url).hostname.toLowerCase().replace(/^www\./, '')  ("" when the URL is not valid)
std::string hostOf(const std::string& url) {
  const std::size_t sep = url.find("://");
  if (sep == std::string::npos || !isValidScheme(url.substr(0, sep))) return {};

  const std::size_t start = sep + 3;
  const std::size_t end = url.find_first_of(ZDM_STR("/\\?#"), start);
  std::string authority = url.substr(start, end == std::string::npos ? std::string::npos : end - start);

  const std::size_t at = authority.rfind('@');  // strip user:password@
  if (at != std::string::npos) authority.erase(0, at + 1);

  if (!authority.empty() && authority[0] == '[') {  // [IPv6]:port
    const std::size_t close = authority.find(']');
    if (close == std::string::npos) return {};
    authority.erase(close + 1);
  } else {
    const std::size_t colon = authority.find(':');  // :port
    if (colon != std::string::npos) authority.erase(colon);
  }

  std::string host = toLower(authority);
  if (host.rfind(ZDM_STR("www."), 0) == 0) host.erase(0, 4);
  return host;
}

bool hostMatches(const std::string& host, const std::string& pattern) {
  std::string needle = toLower(trim(pattern));

  const std::size_t sep = needle.find("://");  // strip scheme
  if (sep != std::string::npos && isValidScheme(needle.substr(0, sep))) needle.erase(0, sep + 3);

  needle = needle.substr(0, needle.find_first_of("/?#"));  // drop path / query / fragment

  const std::size_t colon = needle.rfind(':');  // drop :port
  if (colon != std::string::npos && colon + 1 < needle.size() &&
      needle.find_first_not_of("0123456789", colon + 1) == std::string::npos) {
    needle.erase(colon);
  }
  if (needle.rfind("*.", 0) == 0) needle.erase(0, 2);
  if (needle.rfind(ZDM_STR("www."), 0) == 0) needle.erase(0, 4);
  if (needle.empty()) return false;

  if (host == needle) return true;
  const std::string dotted = "." + needle;
  return host.size() > dotted.size() && host.compare(host.size() - dotted.size(), dotted.size(), dotted) == 0;
}

// path.extname(name).toLowerCase()
std::string extname(const std::string& fileName) {
  const std::size_t slash = fileName.find_last_of(ZDM_STR("/\\"));
  const std::string base = slash == std::string::npos ? fileName : fileName.substr(slash + 1);
  const std::size_t dot = base.rfind('.');
  if (dot == std::string::npos || dot == 0 || base == "..") return {};
  return toLower(base.substr(dot));
}

}  // namespace

CategoryManager::CategoryManager() {
  categories_ = {
      {ZDM_STR("all"), "All Downloads", ZDM_STR("folder"), {}, [](const Record&) { return true; }},
      {ZDM_STR("compressed"), ZDM_STR("Compressed"), ZDM_STR("archive"), {".zip", ".rar", ".7z", ".tar", ".gz"}, nullptr},
      {ZDM_STR("documents"), ZDM_STR("Documents"), ZDM_STR("file-text"), {".pdf", ".doc", ".docx", ".txt", ".xls"}, nullptr},
      {ZDM_STR("music"), ZDM_STR("Sounds"), ZDM_STR("music"), {".mp3", ".flac", ".wav", ".aac", ".ogg"}, nullptr},
      {ZDM_STR("programs"), ZDM_STR("Programs"), ZDM_STR("package"), {".exe", ".msi", ".dmg", ".deb"}, nullptr},
      {ZDM_STR("video"), ZDM_STR("Video"), ZDM_STR("video"), {".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv"}, nullptr},
      {ZDM_STR("images"), ZDM_STR("Images"), ZDM_STR("image"), {".jpg", ".png", ".gif", ".bmp", ".svg", ".webp"}, nullptr},
      {ZDM_STR("unfinished"), ZDM_STR("Unfinished"), ZDM_STR("clock"), {},
       [](const Record& d) { return stringOr(member(d, ZDM_STR("status"))) != ZDM_STR("complete"); }},
      {ZDM_STR("finished"), ZDM_STR("Finished"), ZDM_STR("check-circle"), {},
       [](const Record& d) { return stringOr(member(d, ZDM_STR("status"))) == ZDM_STR("complete"); }},
  };
}

std::string CategoryManager::classify(const std::string& fileName, const std::string& url,
                                      const json& patterns) const {
  const std::string host = hostOf(url);
  if (!host.empty() && patterns.is_object()) {
    for (const char* key : {"video", "music", "programs", "compressed", "documents", "images"}) {
      const json list = member(patterns, key);
      if (!list.is_array()) continue;
      for (const auto& pattern : list) {
        if (pattern.is_string() && hostMatches(host, pattern.get<std::string>())) return key;
      }
    }
  }

  const std::string ext = extname(fileName);
  for (const auto& cat : categories_) {
    if (!cat.extensions.empty() &&
        std::find(cat.extensions.begin(), cat.extensions.end(), ext) != cat.extensions.end()) {
      return cat.key;
    }
  }
  return ZDM_STR("general");
}

const Category* CategoryManager::getCategory(const std::string& name) const {
  for (const auto& c : categories_) {
    if (c.key == name) return &c;
  }
  return nullptr;
}

}  // namespace dm
