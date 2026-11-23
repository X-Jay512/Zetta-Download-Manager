#include "EngineBridge.h"

// Parallel of the private engine behind JS/app/ipc-handlers.js.
// Channel names are declared on EngineBridge. The download, capture,
// and session implementations are not in this display tree.

EngineBridge::EngineBridge(QObject* parent) : Bridge(parent) {}
EngineBridge::~EngineBridge() = default;

QJsonValue EngineBridge::invoke(const QString&, const QJsonValue&) { return {}; }
void EngineBridge::invokeAsync(const QString&, const QJsonValue&, Reply) {}
void EngineBridge::send(const QString&, const QJsonValue&) {}
void EngineBridge::post(std::function<void()>) {}
QJsonValue EngineBridge::playlistCall(const QString&, const QJsonValue&) { return {}; }
void EngineBridge::loadCaBundle() {}
void EngineBridge::startBrowserHost() {}
void EngineBridge::publishExtensionSettings() {}
void EngineBridge::deliverProgress() {}
void EngineBridge::rememberHistory(const QString&) {}
QStringList EngineBridge::loadHistory() const { return {}; }
void EngineBridge::saveHistory(const QStringList&) const {}
QJsonArray EngineBridge::loadPlaylists() const { return {}; }
void EngineBridge::savePlaylists(const QJsonArray&) const {}
