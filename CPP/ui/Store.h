#pragma once
#include "Bridge.h"
#include <QtCore>

// ---- download list state (state.downloads in app.js) + the fdm.on('download:*') handlers
class Store : public QObject {
    Q_OBJECT
public:
    explicit Store(Bridge* b, QObject* parent = nullptr);
    Bridge* bridge() const { return m_b; }
    QVector<QJsonObject>& list() { return m_dl; }
    QJsonObject* find(const QString& id);
    void setStatusQuiet(const QString& id, const QString& st);     // optimistic UI change, no lifecycle signal
    QJsonObject settings() const { return m_settings; }
    void setSettings(const QJsonObject& s) { m_settings = s; emit settingsChanged(); }
    void reload();
signals:
    void listChanged();                              // rows added/removed/renamed -> full repaint
    void rowChanged(const QString& id);              // progress / status of one row
    void lifecycle(const QString& kind, const QString& id);   // complete, error, paused, resumed, added, removed
    void settingsChanged();
private:
    void onEvent(const QString& ch, const QJsonValue& v);
    Bridge* m_b;
    QVector<QJsonObject> m_dl;
    QJsonObject m_settings;
};

// ---- scheduler.js model
struct Queue {
    QString id, name = "New queue", kind = "custom", mode = "once", startAt = "23:00", when = "daily", onceDate, stopAt = "07:30";
    QString openFile, shutdownAction = "shutdown";
    bool startOnLaunch = false, startAtEnabled = false, everyEnabled = false, stopAtEnabled = false, retriesEnabled = false;
    bool openFileEnabled = false, hangup = false, exitApp = false, shutdown = false, forceTerminate = false;
    bool days[7] = {true, true, true, true, true, true, true};
    int everyHours = 2, everyMins = 0, retries = 10;
    QStringList fileIds;
    qint64 nextEvery = 0;
    QJsonObject toJson() const;
    static Queue fromJson(const QJsonObject& o);
};
struct DataCap { bool enabled = false; int mb = 200, hours = 5; bool warn = true; };

class QueueEngine : public QObject {
    Q_OBJECT
public:
    explicit QueueEngine(Store* s);
    QVector<Queue> queues;
    DataCap limits;
    QString activeId = "main", tab = "schedule", selectedFile;
    int concurrent = 1;
    QStringList removed;

    Queue* byId(const QString& id);
    const Queue* queueOf(const QString& dlId);
    QVector<QJsonObject> filesFor(const Queue& q);
    void startNow(const QString& qid = "main");
    void stopNow(const QString& qid = "main");
    void stopAll();
    bool isRunning(const QString& qid) const { return m_running.contains(qid); }
    void assign(const QStringList& ids, const QString& qid);
    void removeFromQueue(const QStringList& ids);
    Queue& createQueue(const QString& name);
    void deleteQueue(const QString& id);
    QVector<Queue> choices(const QStringList& ids);
    int customIndex(const QString& id) const;               // 1-based number shown in sidebar / list
    void load(const QJsonObject& settings);                 // applySavedSettings
    void remember();                                        // settings:update { scheduler: model }
    void materialize(Queue& q);
    void tick();                                            // every 20 s
signals:
    void changed();
private:
    void process(const QString& qid);
    void checkRunning();
    void afterStop(const Queue& q);
    bool dayMatches(const Queue& q, const QDateTime& now) const;
    Store* m_s;
    QSet<QString> m_running, m_failed, m_skipped, m_fired;
    QHash<QString, int> m_retryCount;
};
