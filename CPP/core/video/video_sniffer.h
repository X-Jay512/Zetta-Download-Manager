#pragma once
// sniffer.js -> VideoSniffer: recognises media requests (mp4, HLS, DASH, ...).

#include <cstdint>
#include <map>
#include <optional>
#include <string>

#include "dm_signal.h"

namespace dm {

struct SniffRequest {
  std::string url;
  std::string contentType;
  std::string tabUrl;
  std::string tabTitle;
};

struct DetectedVideo {
  std::string url;
  std::string type;  // "hls" | "dash" | "direct"
  std::string contentType;
  std::string tabUrl;
  std::string tabTitle;
  std::int64_t detectedAt = 0;  // Date.now()
};

class VideoSniffer {
 public:
  // Returns the new entry, or nullopt when the request is not media or was already seen.
  std::optional<DetectedVideo> analyze(const SniffRequest& request);
  void clear() { detectedUrls_.clear(); }
  const std::map<std::string, DetectedVideo>& detectedUrls() const { return detectedUrls_; }

  Signal<const DetectedVideo&> videoDetected;  // 'video-detected'

 private:
  std::map<std::string, DetectedVideo> detectedUrls_;
};

}  // namespace dm
