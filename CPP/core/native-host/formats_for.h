#pragma once
// Port of core/native-host/formats-for.js.
// The capture library and the grabber are passed in. This file does not link them.

#include <functional>
#include <string>

#include <nlohmann/json.hpp>

namespace zdm {

struct FormatDeps {
  std::function<nlohmann::json(const nlohmann::json&)> expandPlaylists;
  std::function<nlohmann::json(const nlohmann::json&)> enrichFormats;
  std::function<nlohmann::json(const nlohmann::json&)> rescueTikTok;
  // Throws on failure. An empty function means no grabber.
  std::function<nlohmann::json(const std::string& url, const std::string& referer, const std::string& cookieFile)>
      extract;
};

std::string guessExt(const std::string& url);
nlohmann::json resolveFormats(const nlohmann::json& body, const FormatDeps& deps);

}  // namespace zdm
