#include "Store.h"
#include "Widgets.h"
#include <QtWidgets>
#include <algorithm>

// =================================================================== Store
Store::Store(Bridge* b, QObject* parent) : QObject(parent), m_b(b) {
    connect(b, &Bridge::event, this, &Store::onEvent);
    m_settings = b->invoke("settings:get").toObject();
    reload();
}
void Store::reload() {
    m_dl.clear();
    for (const auto& v : m_b->invoke("category:get-downloads", "all").toArray()) m_dl.append(v.toObject());
    emit listChanged();
}
QJsonObject* Store::find(const QString& id) {
    for (auto& d : m_dl) if (d.value("id").toString() == id) return &d;
    return nullptr;
}
void Store::setStatusQuiet(const QString& id, const QString& st) {
    if (auto* d = find(id)) { (*d)["status"] = st; emit rowChanged(id); }
}

void Store::onEvent(const QString& ch, const QJsonValue& v) {
    const QJsonObject o = v.toObject();
    const QString id = o.value("id").toString();
    if (ch == "settings:changed") { m_settings = o; emit settingsChanged(); return; }
    if (ch == "download:added") {
        if (!find(o.value("id").toString())) { m_dl.append(o); emit listChanged(); emit lifecycle("added", o.value("id").toString()); }
        return;
    }
    if (ch == "download:removed") {
        QSet<QString> ids; for (const auto& x : o.value("ids").toArray()) ids.insert(x.toString());
        if (ids.isEmpty()) return;
        m_dl.erase(std::remove_if(m_dl.begin(), m_dl.end(), [&](const QJsonObject& d) { return ids.contains(d.value("id").toString()); }), m_dl.end());
        emit listChanged();
        for (const QString& i : ids) emit lifecycle("removed", i);
        return;
    }
    QJsonObject* d = find(id);
    if (!d) return;
    const QString status = d->value("status").toString();
    if (ch == "download:progress") {
        if (status == "paused" || status == "error") return;
        const QString ds = o.value("status").toString();
        if (status == "complete" && ds != "downloading" && (o.value("percent").isNull() || o.value("percent").isUndefined() || o.value("percent").toInt() == 100)) return;
        const bool merging = o.value("phase").toString() == "merging" || ds == "merging" || ds == "muxing";
        (*d)["status"] = merging ? "merging" : "downloading";
        QJsonObject slim = o;
        slim.remove("segments");
        (*d)["progress"] = slim;
        if (o.value("duration").toDouble() > 0) (*d)["duration"] = o.value("duration");
        static qint64 painted = 0;
        const qint64 now = QDateTime::currentMSecsSinceEpoch();
        if (now - painted < 250) return;
        painted = now;
        emit rowChanged(id);
    } else if (ch == "download:complete") {
        (*d)["status"] = "complete"; (*d)["path"] = o.value("path");
        if (!o.value("path").toString().isEmpty()) (*d)["fileName"] = QFileInfo(o.value("path").toString()).fileName();
        emit listChanged(); emit lifecycle("complete", id);
    } else if (ch == "download:metadata") {
        for (const char* k : {"fileName", "fileSize", "audioSize", "duration", "lastTriedAt"})
            if (!o.value(k).isUndefined() && !o.value(k).isNull() && o.value(k).toVariant().toString().size() && o.value(k).toVariant().toString() != "0") (*d)[k] = o.value(k);
        emit listChanged();
    } else if (ch == "download:error") {
        (*d)["status"] = "error"; (*d)["error"] = o.value("error"); (*d)["errorKind"] = o.value("errorKind");
        (*d)["errorTitle"] = o.value("errorTitle").toString().isEmpty() ? "Failed" : o.value("errorTitle").toString();
        emit listChanged(); emit lifecycle("error", id);
    } else if (ch == "download:reset") {
        (*d)["status"] = "queued"; (*d)["error"] = ""; (*d)["errorKind"] = ""; (*d)["errorTitle"] = ""; (*d)["resumable"] = false;
        (*d)["progress"] = QJsonObject{{"downloaded", 0}, {"total", 0}, {"speed", 0}, {"percent", 0}};
        emit rowChanged(id);
    } else if (ch == "download:paused") {
        (*d)["status"] = "paused";
        if (o.contains("savedPercent")) {
            QJsonObject pr = d->value("progress").toObject(); pr["percent"] = o.value("savedPercent"); pr["speed"] = 0; pr["eta"] = QJsonValue::Null;
            (*d)["savedPercent"] = o.value("savedPercent"); (*d)["progress"] = pr;
        }
        emit rowChanged(id); emit lifecycle("paused", id);
    } else if (ch == "download:resumed") {
        (*d)["status"] = "downloading"; (*d)["error"] = ""; (*d)["errorKind"] = ""; (*d)["errorTitle"] = "";
        if (o.value("redownload").toBool()) (*d)["progress"] = QJsonObject{{"downloaded", 0}, {"total", d->value("fileSize")}, {"percent", 0}, {"speed", 0}, {"eta", QJsonValue::Null}};
        emit rowChanged(id); emit lifecycle("resumed", id);
    }
}

// =================================================================== Queue
static const char* kDays[7] = {"sun", "mon", "tue", "wed", "thu", "fri", "sat"};
QJsonObject Queue::toJson() const {
    QJsonObject dj; for (int i = 0; i < 7; ++i) dj[kDays[i]] = days[i];
    return QJsonObject{{"id", id}, {"name", name}, {"kind", kind}, {"mode", mode}, {"startOnLaunch", startOnLaunch}, {"startAtEnabled", startAtEnabled},
        {"startAt", startAt}, {"when", when}, {"onceDate", onceDate}, {"days", dj}, {"everyEnabled", everyEnabled}, {"everyHours", everyHours},
        {"everyMins", everyMins}, {"stopAtEnabled", stopAtEnabled}, {"stopAt", stopAt}, {"retriesEnabled", retriesEnabled}, {"retries", retries},
        {"openFileEnabled", openFileEnabled}, {"openFile", openFile}, {"hangup", false}, {"exitApp", exitApp}, {"shutdown", shutdown},
        {"shutdownAction", shutdownAction}, {"forceTerminate", forceTerminate}, {"fileIds", QJsonArray::fromStringList(fileIds)}};
}
Queue Queue::fromJson(const QJsonObject& o) {
    Queue q;
    q.id = o.value("id").toString("q-" + QString::number(QDateTime::currentMSecsSinceEpoch()));
    q.name = o.value("name").toString(q.name); q.kind = o.value("kind").toString("custom"); q.mode = o.value("mode").toString("once");
    q.startOnLaunch = o.value("startOnLaunch").toBool(); q.startAtEnabled = o.value("startAtEnabled").toBool(); q.startAt = o.value("startAt").toString("23:00");
    q.when = o.value("when").toString("daily"); q.onceDate = o.value("onceDate").toString(QDate::currentDate().toString(Qt::ISODate));
    const QJsonObject dj = o.value("days").toObject();
    for (int i = 0; i < 7; ++i) q.days[i] = dj.contains(kDays[i]) ? dj.value(kDays[i]).toBool() : true;
    q.everyEnabled = o.value("everyEnabled").toBool(); q.everyHours = o.value("everyHours").toInt(2); q.everyMins = o.value("everyMins").toInt(0);
    q.stopAtEnabled = o.value("stopAtEnabled").toBool(); q.stopAt = o.value("stopAt").toString("07:30");
    q.retriesEnabled = o.value("retriesEnabled").toBool(); q.retries = o.value("retries").toInt(10);
    q.openFileEnabled = o.value("openFileEnabled").toBool(); q.openFile = o.value("openFile").toString();
    q.exitApp = o.value("exitApp").toBool(); q.shutdown = o.value("shutdown").toBool(); q.shutdownAction = o.value("shutdownAction").toString("shutdown");
    q.forceTerminate = o.value("forceTerminate").toBool();
    for (const auto& v : o.value("fileIds").toArray()) q.fileIds << v.toString();
    return q;
}

// =================================================================== QueueEngine
QueueEngine::QueueEngine(Store* s) : QObject(s), m_s(s) {
    Queue m; m.id = "main"; m.name = "General queue"; m.kind = "main"; m.onceDate = QDate::currentDate().toString(Qt::ISODate);
    Queue y; y.id = "sync"; y.name = "Repeat queue"; y.kind = "sync"; y.mode = "periodic"; y.everyEnabled = true; y.onceDate = m.onceDate;
    queues = {m, y};
    load(s->settings());
    connect(s, &Store::settingsChanged, this, [this] { load(m_s->settings()); emit changed(); });
    connect(s, &Store::lifecycle, this, [this](const QString& kind, const QString& id) {
        if (kind == "complete" || kind == "resumed" || kind == "removed" || kind == "added") { checkRunning(); }
        else if (kind == "error") {
            const Queue* q = queueOf(id);
            if (q && q->retriesEnabled && q->retries > 0) {
                int& n = m_retryCount[id];
                if (n < q->retries) { ++n; const QString qid = q->id; QTimer::singleShot(3000, this, [this, id, qid] { if (m_running.contains(qid)) m_s->bridge()->send("download:resume", id); }); emit changed(); return; }
            }
            m_failed.insert(id); checkRunning();
        } else if (kind == "paused") {
            const Queue* q = queueOf(id);
            if (q && m_running.contains(q->id)) { m_skipped.insert(id); checkRunning(); }
        }
        emit changed();
    });
    auto* t = new QTimer(this); connect(t, &QTimer::timeout, this, &QueueEngine::tick); t->start(20000);
}

void QueueEngine::load(const QJsonObject& settings) {                      // applySavedSettings
    const QJsonObject sv = settings.value("scheduler").toObject();
    if (!sv.value("queues").toArray().isEmpty()) {
        queues.clear();
        for (const auto& v : sv.value("queues").toArray()) {
            Queue q = Queue::fromJson(v.toObject());
            if (q.id == "main" && (q.name == "Main download queue" || q.name == "Everyday queue")) q.name = "General queue";
            if (q.id == "sync" && q.name == "Synchronization queue") q.name = "Repeat queue";
            queues << q;
        }
        const QJsonObject l = sv.value("limits").toObject();
        limits.enabled = l.value("enabled").toBool(limits.enabled); limits.mb = l.value("mb").toInt(limits.mb);
        limits.hours = l.value("hours").toInt(limits.hours); limits.warn = l.value("warn").toBool(limits.warn);
        activeId = sv.value("activeId").toString("main");
        removed.clear(); for (const auto& v : sv.value("removed").toArray()) removed << v.toString();
        const int c = sv.value("concurrent").toInt(1);
        concurrent = (c && c != 4) ? c : 1;
    } else {
        const QJsonObject sp = settings.value("speed").toObject();
        if (!sp.isEmpty()) { limits.enabled = sp.value("limitEnabled").toBool(); limits.mb = sp.value("limitMB").toInt(200);
            limits.hours = sp.value("limitHours").toInt(5); limits.warn = sp.value("warnBeforeStop").toBool(true); }
    }
}
void QueueEngine::remember() {
    QJsonArray qa; for (const Queue& q : queues) qa.append(q.toJson());
    QJsonObject model{{"activeId", activeId}, {"tab", tab}, {"concurrent", concurrent}, {"removed", QJsonArray::fromStringList(removed)},
        {"queues", qa}, {"limits", QJsonObject{{"enabled", limits.enabled}, {"mb", limits.mb}, {"hours", limits.hours}, {"warn", limits.warn}}}};
    m_s->bridge()->invoke("settings:update", QJsonObject{{"scheduler", model}});
    emit changed();
}

Queue* QueueEngine::byId(const QString& id) { for (auto& q : queues) if (q.id == id) return &q; return nullptr; }
int QueueEngine::customIndex(const QString& id) const {
    int n = 0; for (const auto& q : queues) if (q.kind == "custom") { ++n; if (q.id == id) return n; } return 1;
}
const Queue* QueueEngine::queueOf(const QString& id) {
    if (removed.contains(id)) return nullptr;
    const QJsonObject* dl = m_s->find(id);
    if (!dl || dl->value("status").toString() == "complete") return nullptr;
    for (const auto& q : queues) if (q.fileIds.contains(id)) return &q;
    return byId("main");
}
QVector<QJsonObject> QueueEngine::filesFor(const Queue& q) {
    QVector<QJsonObject> out;
    for (const auto& d : m_s->list()) { const Queue* t = queueOf(d.value("id").toString()); if (t && t->id == q.id) out << d; }
    std::stable_sort(out.begin(), out.end(), [&](const QJsonObject& a, const QJsonObject& b) {
        const int ia = q.fileIds.indexOf(a.value("id").toString()), ib = q.fileIds.indexOf(b.value("id").toString());
        return (ia < 0 ? 999999 : ia) < (ib < 0 ? 999999 : ib);
    });
    return out;
}
void QueueEngine::materialize(Queue& q) { QStringList ids; for (const auto& d : filesFor(q)) ids << d.value("id").toString(); q.fileIds = ids; }

void QueueEngine::process(const QString& qid) {
    if (!m_running.contains(qid)) return;
    Queue* q = byId(qid);
    if (!q) { m_running.remove(qid); return; }
    const auto files = filesFor(*q);
    QVector<QJsonObject> active, pending;
    for (const auto& f : files) {
        const QString st = f.value("status").toString(), id = f.value("id").toString();
        if (st == "downloading" || st == "merging") active << f;
        else if (!m_failed.contains(id) && !m_skipped.contains(id) && (st == "paused" || st == "error" || st == "queued")) pending << f;
    }
    if (active.isEmpty() && pending.isEmpty()) { m_running.remove(qid); afterStop(*q); emit changed(); return; }
    const int needed = qMax(1, concurrent) - active.size();
    for (int i = 0; i < needed && i < pending.size(); ++i) {
        const QString id = pending[i].value("id").toString();
        m_s->setStatusQuiet(id, "downloading");
        m_s->bridge()->send("download:resume", id);
    }
    emit changed();
}
void QueueEngine::checkRunning() { for (const QString& id : QStringList(m_running.values())) process(id); }
void QueueEngine::startNow(const QString& qid) { m_running.insert(qid); m_failed.clear(); m_skipped.clear(); process(qid); }
void QueueEngine::stopNow(const QString& qid) {
    m_running.remove(qid); m_failed.clear(); m_skipped.clear();
    if (Queue* q = byId(qid)) for (const auto& f : filesFor(*q))
        if (f.value("status").toString() == "downloading" || f.value("status").toString() == "merging") m_s->bridge()->send("download:pause", f.value("id").toString());
    emit changed();
}
void QueueEngine::stopAll() { m_running.clear(); m_failed.clear(); m_skipped.clear(); emit changed(); }

void QueueEngine::assign(const QStringList& ids, const QString& qid) {
    Queue* t = byId(qid); if (!t) return;
    for (auto& q : queues) for (const QString& id : ids) q.fileIds.removeAll(id);
    for (const QString& id : ids) { if (!t->fileIds.contains(id)) t->fileIds << id; removed.removeAll(id); }
    remember();
}
void QueueEngine::removeFromQueue(const QStringList& ids) {
    for (auto& q : queues) for (const QString& id : ids) q.fileIds.removeAll(id);
    for (const QString& id : ids) if (!removed.contains(id)) removed << id;
    remember();
}
Queue& QueueEngine::createQueue(const QString& name) {
    Queue q; q.id = "q-" + QString::number(QDateTime::currentMSecsSinceEpoch()); q.name = name; q.onceDate = QDate::currentDate().toString(Qt::ISODate);
    queues << q; remember(); return queues.last();
}
void QueueEngine::deleteQueue(const QString& id) {
    queues.erase(std::remove_if(queues.begin(), queues.end(), [&](const Queue& q) { return q.id == id && q.kind == "custom"; }), queues.end());
    if (activeId == id) activeId = "main";
    remember();
}
QVector<Queue> QueueEngine::choices(const QStringList& ids) {
    QSet<QString> taken; for (const QString& id : ids) if (const Queue* q = queueOf(id)) taken.insert(q->id);
    const bool unique = taken.size() == 1 && !ids.isEmpty();
    QVector<Queue> out; for (const auto& q : queues) if (!unique || q.id != *taken.begin()) out << q;
    return out;
}

void QueueEngine::afterStop(const Queue& q) {
    if (q.openFileEnabled && !q.openFile.isEmpty()) m_s->bridge()->send("download:open-file", q.openFile);
    if (q.exitApp && askBox(nullptr, QMessageBox::Question, "Zetta Download Manager", "Exit Zetta Download Manager?", QMessageBox::Yes | QMessageBox::No, QMessageBox::Yes) == QMessageBox::Yes) m_s->bridge()->send("window:close");
    if (q.shutdown && askBox(nullptr, QMessageBox::Question, "Zetta Download Manager", "Turn off the computer now?", QMessageBox::Yes | QMessageBox::No, QMessageBox::Yes) == QMessageBox::Yes)
        m_s->bridge()->invoke("system:power", QJsonObject{{"action", q.shutdownAction.isEmpty() ? "shutdown" : q.shutdownAction}, {"force", q.forceTerminate}});
}
bool QueueEngine::dayMatches(const Queue& q, const QDateTime& now) const {
    if (q.mode != "periodic" && q.when == "once") return q.onceDate == now.date().toString(Qt::ISODate);
    return q.days[now.date().dayOfWeek() % 7];
}
void QueueEngine::tick() {
    const QDateTime now = QDateTime::currentDateTime();
    const QString hm = now.toString("HH:mm"), stamp = now.toString("ddd MMM dd yyyy ") + hm;
    for (int i = 0; i < queues.size(); ++i) {
        Queue& q = queues[i];
        if (q.startAtEnabled && q.startAt == hm && dayMatches(q, now) && !m_fired.contains(q.id + ":start:" + stamp)) { m_fired.insert(q.id + ":start:" + stamp); startNow(q.id); }
        if (q.mode == "periodic" && q.everyEnabled && dayMatches(q, now)) {
            const qint64 span = (qint64(q.everyHours) * 60 + q.everyMins) * 60000;
            if (span >= 60000) {
                if (!q.nextEvery) q.nextEvery = QDateTime::currentMSecsSinceEpoch() + span;
                if (QDateTime::currentMSecsSinceEpoch() >= q.nextEvery && !m_fired.contains(q.id + ":every:" + stamp)) {
                    m_fired.insert(q.id + ":every:" + stamp); q.nextEvery = QDateTime::currentMSecsSinceEpoch() + span; startNow(q.id);
                }
            }
        }
        if (q.stopAtEnabled && q.stopAt == hm && !m_fired.contains(q.id + ":stop:" + stamp)) { m_fired.insert(q.id + ":stop:" + stamp); const Queue copy = q; stopNow(q.id); afterStop(copy); }
    }
    emit changed();
}
