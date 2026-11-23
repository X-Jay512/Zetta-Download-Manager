#pragma once
// Browser install channels used by the Extension tab and the setup window.
// The slow calls (scan, status, install) are safe to run off the UI thread.

#include <QJsonArray>
#include <QJsonObject>
#include <QString>

#include <filesystem>

namespace zdm {
class NativeHostServer;
}

namespace zdmui {

QJsonArray scanBrowsers(const QJsonArray& previous);
QJsonArray browserStatus(const QJsonArray& detected);
QJsonObject installBrowser(const QString& browserId, const QJsonObject& row, const std::filesystem::path& userData,
                           zdm::NativeHostServer* host);
QJsonObject copyExtensionPath(const QString& kind);
QJsonObject openGuide(const QString& name);
QJsonObject copyGuideText(const QString& text);

}  // namespace zdmui
