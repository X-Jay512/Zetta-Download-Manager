#pragma once
// The real backend behind the same channel names the windows already use.

#include "Bridge.h"

#include <filesystem>
#include <memory>
#include <mutex>
#include <thread>
#include <unordered_map>

namespace zdm {
class NativeHostServer;
}
class HlsPage;

class EngineBridge : public Bridge {
    Q_OBJECT
public:
    explicit EngineBridge(QObject* parent = nullptr);
    ~EngineBridge() override;

    QJsonValue invoke(const QString& channel, const QJsonValue& arg = QJsonValue()) override;
    void invokeAsync(const QString& channel, const QJsonValue& arg, Reply cb) override;
    void send(const QString& channel, const QJsonValue& arg = QJsonValue()) override;

private:
    struct Core;
    void post(std::function<void()> fn);
    QJsonValue playlistCall(const QString& channel, const QJsonValue& arg);
    void loadCaBundle();
    void startBrowserHost();
    void publishExtensionSettings();
    void deliverProgress();
    void rememberHistory(const QString& url);
    QStringList loadHistory() const;
    void saveHistory(const QStringList& urls) const;
    QJsonArray loadPlaylists() const;
    void savePlaylists(const QJsonArray& list) const;

    std::filesystem::path m_userData;
    std::unique_ptr<HlsPage> m_hls;
    std::unique_ptr<Core> m_core;
    std::unique_ptr<zdm::NativeHostServer> m_host;
    std::thread m_loopThread;
    std::mutex m_infoMu;
    std::mutex m_progressMu;
    std::unordered_map<std::string, QJsonObject> m_pendingProgress;
    std::unordered_map<std::string, int> m_connCap;
    bool m_progressArmed = false;
    qint64 m_progressSavedAt = 0;
};
