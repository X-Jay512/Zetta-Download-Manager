#include "zdm_str.hpp"
#include "video_sniffer.h"

#include <algorithm>

#include "util.h"

namespace dm {

namespace {

// /\.ext(\?|$)/i
const char* const kMediaExtensions[] = {".mp4", ".webm", ".mkv", ".flv", ".avi",
                                        ".mov", ZDM_STR(".m3u8"), ".ts",  ZDM_STR(".mpd")};

const char* const kMediaMimeTypes[] = {
    ZDM_STR("video/mp4"), ZDM_STR("video/webm"), ZDM_STR("video/x-flv"), ZDM_STR("video/x-matroska"),
    ZDM_STR("application/vnd.apple.mpegurl"), ZDM_STR("application/x-mpegURL"), ZDM_STR("video/MP2T"),
    ZDM_STR("application/dash+xml"), ZDM_STR("audio/mpeg"), ZDM_STR("audio/mp4")};

bool hasExtension(const std::string& lowerUrl, const std::string& ext) {
  for (std::size_t pos = lowerUrl.find(ext); pos != std::string::npos; pos = lowerUrl.find(ext, pos + 1)) {
    const std::size_t next = pos + ext.size();
    if (next == lowerUrl.size() || lowerUrl[next] == '?') return true;
  }
  return false;
}

bool matchesPattern(const std::string& url) {
  const std::string lower = toLower(url);
  return std::any_of(std::begin(kMediaExtensions), std::end(kMediaExtensions),
                     [&](const char* ext) { return hasExtension(lower, ext); });
}

bool matchesMime(const std::string& mime) {
  if (mime.empty()) return false;
  const std::string lower = toLower(mime);
  return std::any_of(std::begin(kMediaMimeTypes), std::end(kMediaMimeTypes), [&](const char* m) {
    return lower.find(toLower(m)) != std::string::npos;
  });
}

// Note: the mime checks are case-sensitive, exactly like the original (so "x-mpegURL" alone is "direct").
std::string classifyType(const std::string& url, const std::string& mime) {
  const std::string lower = toLower(url);
  if (lower.find(ZDM_STR(".m3u8")) != std::string::npos || mime.find(ZDM_STR("mpegurl")) != std::string::npos) return ZDM_STR("hls");
  if (lower.find(ZDM_STR(".mpd")) != std::string::npos || mime.find(ZDM_STR("dash")) != std::string::npos) return ZDM_STR("dash");
  return ZDM_STR("direct");
}

}  // namespace

std::optional<DetectedVideo> VideoSniffer::analyze(const SniffRequest& request) {
  if (!(matchesPattern(request.url) || matchesMime(request.contentType))) return std::nullopt;
  if (detectedUrls_.count(request.url)) return std::nullopt;

  DetectedVideo entry;
  entry.url = request.url;
  entry.type = classifyType(request.url, request.contentType);
  entry.contentType = request.contentType;
  entry.tabUrl = request.tabUrl;
  entry.tabTitle = request.tabTitle;
  entry.detectedAt = nowMs();

  detectedUrls_[request.url] = entry;
  videoDetected.emit(entry);
  return entry;
}

}  // namespace dm
