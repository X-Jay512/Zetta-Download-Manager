#include "server.h"

// Parallel of JS/core/native-host/server.js.
// The route table and the capture handlers are not in this display tree.

namespace zdm {
NativeHostServer::NativeHostServer(std::string) {}
NativeHostServer::~NativeHostServer() = default;
void NativeHostServer::setServices(HostServices) {}
void NativeHostServer::setEvents(HostEvents) {}
void NativeHostServer::setExtensionDist(std::string) {}
void NativeHostServer::setExtensionSettings(nlohmann::json) {}
void NativeHostServer::confirmResult(const std::string&, const nlohmann::json&) {}
void NativeHostServer::settleCatch(const std::string&, const nlohmann::json&) {}
bool NativeHostServer::isBrowserConnected(const std::string&) const { return false; }
std::vector<std::string> NativeHostServer::connectedBrowsers() const { return {}; }
void NativeHostServer::start() {}
void NativeHostServer::stop() {}
FormatDeps formatDepsFrom(const HostServices&) { return {}; }
}
