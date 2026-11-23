#pragma once
// Port of core/native-host/server.js.
// Listens on a local pipe and a local port. The port numbers are not in this copy.
// Capture, the grabber, and the download windows are callbacks. Calling start()
// is left to whoever connects this later.

#include <functional>
#include <memory>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "formats_for.h"

namespace zdm {

inline constexpr int kNativeHttpPort = 0;
inline constexpr int kBrowserSeenMs = 150000;

struct HostServices {
  std::function<nlohmann::json(const nlohmann::json&)> ingestCapture;
  std::function<nlohmann::json(const nlohmann::json&)> resolveFacts;
  std::function<nlohmann::json(const nlohmann::json&)> rescueTikTok;
  std::function<std::string(const std::string& text, const std::string& url, const std::string& wanted)> pickHlsVariant;
  std::function<nlohmann::json(const nlohmann::json&)> expandPlaylists;
  std::function<nlohmann::json(const nlohmann::json&)> enrichFormats;
  std::function<nlohmann::json(const nlohmann::json&)> sniffBatch;
  std::function<nlohmann::json(const nlohmann::json&)> downloadPlan;
  std::function<nlohmann::json(const nlohmann::json& body, const nlohmann::json& settings, const std::string& browserId)>
      decideDownload;
  std::function<bool(const nlohmann::json& settings, const std::string& browserId)> pageActive;
  std::function<nlohmann::json()> pageRules;
  std::function<nlohmann::json(const nlohmann::json& formats, const nlohmann::json& settings)> buildMenu;
  std::function<nlohmann::json(const std::string& url, const std::string& referer, const std::string& cookieFile)> extract;
};

// Reply callbacks must be called, on this thread or later. A null JSON value
// selects the route's fallback body.
struct HostEvents {
  std::function<void(const nlohmann::json&)> onSettingsPatch;
  std::function<void(const nlohmann::json&)> onBrowserSave;
  std::function<void(const nlohmann::json&)> onBrowserConnected;
  std::function<void(const nlohmann::json&)> onNewDownload;
  std::function<void(const nlohmann::json&)> onVideoDetected;
  std::function<void(const nlohmann::json&)> onGetQualities;
  std::function<void(const nlohmann::json&)> onSessionHlsHold;
  std::function<void(const nlohmann::json&, const std::function<void(nlohmann::json)>&)> onSessionHlsNext;
  std::function<void(const std::function<void(nlohmann::json)>&)> onSessionPending;
  std::function<void(const std::function<void(nlohmann::json)>&)> onSessionHlsPending;
  std::function<void(const std::string&, const std::function<void(nlohmann::json)>&)> onSessionHlsStatus;
  std::function<void(const nlohmann::json&)> onSessionHlsLanes;
  std::function<void(const nlohmann::json&)> onSessionHlsTick;
  std::function<void(const nlohmann::json&, const std::function<void(nlohmann::json)>&)> onSessionHlsPiece;
  std::function<void(const std::function<void(nlohmann::json)>&)> onSessionFilePending;
  std::function<void(const std::string&, const std::function<void(nlohmann::json)>&)> onSessionFileStatus;
  std::function<void(const nlohmann::json&, const std::function<void(nlohmann::json)>&)> onSessionFileChunk;
  std::function<void(const nlohmann::json&)> onSessionFileDrop;
  std::function<void(const nlohmann::json&, const std::function<void(nlohmann::json)>&)> onSessionFileArm;
  std::function<void(const nlohmann::json&, const std::function<void(nlohmann::json)>&)> onSessionFileRestart;
  std::function<void(const nlohmann::json&)> onSessionFileFinish;
  std::function<void(const nlohmann::json&)> onSessionFileFail;
  std::function<void(const nlohmann::json&, const std::function<void(nlohmann::json)>&)> onSessionHlsFinish;
  std::function<void(const nlohmann::json&, const std::function<void(nlohmann::json)>&)> onSessionHlsFail;
  std::function<void(const nlohmann::json&, const std::function<void(nlohmann::json)>&)> onSessionHlsStart;
};

class NativeHostServer {
 public:
  explicit NativeHostServer(std::string version = "1.0.2");
  ~NativeHostServer();

  NativeHostServer(const NativeHostServer&) = delete;
  NativeHostServer& operator=(const NativeHostServer&) = delete;

  void setServices(HostServices services);
  void setEvents(HostEvents events);
  void setExtensionDist(std::string directory);
  void setExtensionSettings(nlohmann::json slice);

  void confirmResult(const std::string& id, const nlohmann::json& result);
  void settleCatch(const std::string& token, const nlohmann::json& value);
  bool isBrowserConnected(const std::string& id) const;
  std::vector<std::string> connectedBrowsers() const;

  void start();
  void stop();

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

FormatDeps formatDepsFrom(const HostServices& services);

}  // namespace zdm
