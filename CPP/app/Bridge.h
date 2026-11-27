#pragma once
// C++ stand-in for the preload bridge.
// Same channel names as the JS code, so wiring your real engine (the C++ HLS handler etc.) is 1:1.
#include <QtCore>
#include <functional>

class Bridge : public QObject {
    Q_OBJECT
public:
    explicit Bridge(QObject* parent = nullptr) : QObject(parent) {}
    using Reply = std::function<void(const QJsonValue& value, const QString& error)>;

    // fdm.invoke(channel, arg)  -> synchronous reply
    virtual QJsonValue invoke(const QString& channel, const QJsonValue& arg = QJsonValue()) = 0;
    // fdm.invoke(...) for slow calls (grabber:extract, playlist:list, playlist:formats ...) -> async reply
    virtual void invokeAsync(const QString& channel, const QJsonValue& arg, Reply cb) {
        QTimer::singleShot(0, this, [=] { cb(invoke(channel, arg), QString()); });
    }
    // fdm.send(channel, arg)    -> fire and forget
    virtual void send(const QString& channel, const QJsonValue& arg = QJsonValue()) = 0;

signals:
    // fdm.on(channel, handler): 'download:progress', 'download:complete', 'download:metadata', 'download:error',
    // 'download:reset', 'download:paused', 'download:resumed', 'download:added', 'download:removed',
    // 'settings:changed', 'appearance:changed', 'playlists:changed', 'queue:start', 'queue:start-all',
    // 'queue:stop-all', 'browser:status-changed', 'address:prefill', 'address:history-pick'
    void event(const QString& channel, const QJsonValue& payload);
    // main-process window requests: "address", "add", "complete", "progress", "properties", "playlist",
    // "settings", "scheduler", "refresh-ask", "refresh-wait"
    void openWindow(const QString& name, const QJsonValue& arg);
};

// Standalone backend so the UI runs and can be compared with the Electron build. Replace with your engine.
class MockBridge : public Bridge {
    Q_OBJECT
public:
    explicit MockBridge(bool demo);
    QJsonValue invoke(const QString& channel, const QJsonValue& arg = QJsonValue()) override;
    void send(const QString& channel, const QJsonValue& arg = QJsonValue()) override;
private:
    QJsonObject defaults() const;
    void save();
    void tick();
    QJsonObject m_settings;
    QJsonArray m_downloads;
    QJsonArray m_playlists;
    QStringList m_history;
    QTimer m_timer;
    QString m_file;
};
