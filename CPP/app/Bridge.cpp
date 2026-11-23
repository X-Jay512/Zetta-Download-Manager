#include "Bridge.h"
#include "zdm_str.hpp"
#include <QtWidgets>

static QJsonObject deepMerge(QJsonObject base, const QJsonObject& over) {
    for (auto it = over.begin(); it != over.end(); ++it) {
        if (it.value().isObject() && base.value(it.key()).isObject())
            base[it.key()] = deepMerge(base.value(it.key()).toObject(), it.value().toObject());
        else base[it.key()] = it.value();
    }
    return base;
}

QJsonObject MockBridge::defaults() const {
    const QString base = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
    auto f = [&](const char* sub) { return sub[0] ? base + "/" + sub : base; };
    QJsonObject o;
    o["launch"] = QJsonObject{{"startWithWindows", false}, {"startMinimized", false}, {"showNotifications", true}, {"keepAwake", true}};
    o["catch"] = QJsonObject{{"detected", QJsonArray{}}};
    o["library"] = QJsonObject{{"defaultPath", base}, {"tempPath", base + ZDM_STR("/.parts")}, {"rememberLastFolder", true}, {"useServerFileTime", false}, {"removeMissing", false},
        {"folders", QJsonObject{{"general", f("")}, {"compressed", f("Compressed")}, {"documents", f("Documents")}, {"music", f("Sounds")},
                                {"programs", f("Programs")}, {"video", f("Video")}, {"images", f("Images")}}}};
    o["behavior"] = QJsonObject{{"confirmBeforeStart", true}, {"showCompleteDialog", true}, {"startWhileDialog", true}, {"queueOnLater", true},
        {"confirmDelete", true}, {"ignoreMtime", false}, {"ignoreSsl", false}, {"retryFailed", false}, {"retryCount", 3},
        {"duplicateAction", "ask"}, {"cancelAsk", true}, {"cancelAction", "keep"}};
    o["speed"] = QJsonObject{{ZDM_STR("connectionsPerFile"), 8}, {"maxConcurrent", 0}, {"throttleEnabled", false}, {"throttleValue", 1}, {"throttleUnit", "MB"},
        {"limitEnabled", false}, {"limitMB", 200}, {"limitHours", 5}, {"warnBeforeStop", true}, {"exceptions", QJsonArray{}}};
    o["proxy"] = QJsonObject{{"enabled", false}, {"mode", "off"}, {"type", "http"}, {"host", ""}, {"port", 0}, {"username", ""}, {"password", ""}};
    o["appearance"] = QJsonObject{{"theme", "theme3"}, {"columnLines", false}, {"iconSaturation", 100}};
    o["list"] = QJsonObject{{"sortCol", QJsonValue::Null}, {"sortAsc", true}};
    return o;
}

MockBridge::MockBridge(bool demo) {
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir().mkpath(dir);
    m_file = dir + ZDM_STR("/settings.json");
    m_settings = defaults();
    QFile f(m_file);
    if (f.open(QIODevice::ReadOnly)) m_settings = deepMerge(m_settings, QJsonDocument::fromJson(f.readAll()).object());
    if (demo) {
        const QDateTime now = QDateTime::currentDateTimeUtc();
        auto mk = [&](const QString& id, const QString& name, const QString& st, double size, double pct, int minsAgo) {
            return QJsonObject{{"id", id}, {"fileName", name}, {"url", "https://example.com/files/" + name}, {"status", st},
                {"fileSize", size}, {"createdAt", now.addSecs(-60 * minsAgo).toString(Qt::ISODate)}, {"resumable", true},
                {"path", st == "complete" ? QString(m_settings["library"].toObject()["defaultPath"].toString() + "/" + name) : QString()},
                {"progress", QJsonObject{{"percent", pct}, {"downloaded", size * pct / 100}, {"total", size}, {"speed", 0}}}};
        };
        m_downloads = QJsonArray{mk("1", "ubuntu-24.04-desktop-amd64.iso", "downloading", 6.1e9, 41, 3), mk("2", "setup-installer.exe", "paused", 8.2e7, 63, 25),
                                 mk("3", "annual-report-2026.pdf", "complete", 4.4e6, 100, 190), mk("4", "holiday-clip.mp4", "queued", 1.3e9, 0, 400),
                                 mk("5", "broken-archive.zip", "error", 2.2e8, 12, 1500)};
        m_downloads[4] = [&] { QJsonObject o = m_downloads[4].toObject(); o["error"] = "Server closed the connection"; o["errorTitle"] = "Disconnected"; return o; }();
    }
    m_timer.setInterval(500);
    connect(&m_timer, &QTimer::timeout, this, [this] { tick(); });
    m_timer.start();
}

void MockBridge::save() {
    QFile f(m_file);
    if (f.open(QIODevice::WriteOnly)) f.write(QJsonDocument(m_settings).toJson());
}

void MockBridge::tick() {
    for (int i = 0; i < m_downloads.size(); ++i) {
        QJsonObject d = m_downloads[i].toObject();
        if (d["status"].toString() != "downloading") continue;
        QJsonObject pr = d["progress"].toObject();
        const double total = d["fileSize"].toDouble();
        double got = pr["downloaded"].toDouble() + 6e6;
        if (got >= total) { got = total; d["status"] = "complete"; d["path"] = m_settings["library"].toObject()["defaultPath"].toString() + "/" + d["fileName"].toString();
            m_downloads[i] = d; emit event("download:complete", QJsonObject{{"id", d["id"]}, {"path", d["path"]}}); continue; }
        pr["downloaded"] = got; pr["total"] = total; pr["percent"] = qRound(got / total * 100.0); pr["speed"] = 12e6; pr["eta"] = (total - got) / 12e6;
        QJsonArray segs;
        for (int s = 0; s < 8; ++s) segs.append(QJsonObject{{"index", s}, {"start", s * total / 8}, {"end", (s + 1) * total / 8 - 1}, {"downloaded", got / 8},
            {"percent", got / total * 100.0}, {"status", "downloading"}});
        pr["segments"] = segs;
        pr["id"] = d["id"]; pr["status"] = "downloading";
        d["progress"] = pr; m_downloads[i] = d;
        emit event("download:progress", pr);
    }
}

QJsonValue MockBridge::invoke(const QString& ch, const QJsonValue& arg) {
    if (ch == "settings:get") return m_settings;
    if (ch == "settings:update") { m_settings = deepMerge(m_settings, arg.toObject()); save(); emit event("settings:changed", m_settings); return m_settings; }
    if (ch == "settings:restore-part") { const QString pane = arg.toString(); const QJsonObject d = defaults(); if (d.contains(pane)) m_settings[pane] = d[pane]; save(); return m_settings; }
    if (ch == "category:get-downloads") return m_downloads;
    if (ch == "settings:pick-folder") return QFileDialog::getExistingDirectory(nullptr, "Choose folder");
    if (ch == "shell:pick-file") return QFileDialog::getOpenFileName(nullptr, "Choose file");
    if (ch == "app:get-address-history") return QJsonArray::fromStringList(m_history);
    if (ch == "app:get-address-prefill") return QApplication::clipboard()->text().startsWith("http") ? QApplication::clipboard()->text().trimmed() : QString();
    if (ch == "window:confirm-address") {
        const QJsonObject a = arg.toObject();
        const QString url = a["url"].toString();
        if (!QUrl(url).isValid() || !url.contains("://")) return QJsonObject{{"ok", false}, {"error", "Enter a valid address."}};
        m_history.removeAll(url); m_history.prepend(url);
        QJsonObject d{{"url", url}, {"fileName", url.section('/', -1).section('?', 0, 0)}, {"size", 0}, {"login", a["login"]}, {"password", a["password"]}, {"manual", true}};
        emit openWindow("add", d);
        return QJsonObject{{"ok", true}};
    }
    if (ch == "download:add") {
        QJsonObject o = arg.toObject();
        const QString id = QString::number(QDateTime::currentMSecsSinceEpoch());
        QJsonObject rec{{"id", id}, {"fileName", o["fileName"]}, {"url", o["url"]}, {"status", o["queueOnly"].toBool() ? "queued" : "downloading"},
            {"fileSize", o["fileSize"]}, {"createdAt", QDateTime::currentDateTimeUtc().toString(Qt::ISODate)}, {"savePath", o["savePath"]},
            {"description", o["description"]}, {"progress", QJsonObject{{"percent", 0}, {"downloaded", 0}, {"total", o["fileSize"]}}}};
        m_downloads.append(rec);
        emit event("download:added", rec);
        if (!o["queueOnly"].toBool()) emit openWindow("progress", id);
        return rec;
    }
    if (ch == "progress:get") {
        for (const auto& v : m_downloads) if (v.toObject().value("id").toString() == arg.toString()) { const QJsonObject r = v.toObject(); return QJsonObject{{"record", r}, {"progress", r["progress"]}, {"globalThreads", m_settings["speed"].toObject()[ZDM_STR("connectionsPerFile")]},
            {"cancelAsk", m_settings["behavior"].toObject()["cancelAsk"]}, {"cancelAction", m_settings["behavior"].toObject()["cancelAction"]}}; }
        return QJsonValue::Null;
    }
    if (ch == "playlist:saved") return m_playlists;
    if (ch == "playlist:queues") return QJsonArray{};
    if (ch == "playlist:remember") { QJsonObject o = arg.toObject(); m_playlists.append(o); emit event("playlists:changed", QJsonValue()); return QJsonValue(); }
    if (ch == "playlist:remove") { for (int i = 0; i < m_playlists.size(); ++i) if (m_playlists[i].toObject().value("url").toString() == arg.toString()) { m_playlists.removeAt(i); break; } emit event("playlists:changed", QJsonValue()); return QJsonValue(); }
    if (ch == "playlist:create-queue") return QJsonObject{{"id", "q-" + QString::number(QDateTime::currentMSecsSinceEpoch())}};
    return QJsonValue::Null;          // channels the real engine must implement are listed in Bridge.h
}

void MockBridge::send(const QString& ch, const QJsonValue& arg) {
    auto setStatus = [&](const QString& id, const QString& st, const QString& evt) {
        for (int i = 0; i < m_downloads.size(); ++i) { QJsonObject d = m_downloads[i].toObject(); if (d["id"].toString() == id) { d["status"] = st; m_downloads[i] = d; emit event(evt, QJsonObject{{"id", id}}); } }
    };
    if (ch == "download:pause") setStatus(arg.toString(), "paused", "download:paused");
    else if (ch == "download:resume") setStatus(arg.toString(), "downloading", "download:resumed");
    else if (ch == "download:remove") {
        const QString id = arg.isObject() ? arg.toObject()["id"].toString() : arg.toString();
        for (int i = 0; i < m_downloads.size(); ++i) if (m_downloads[i].toObject()["id"].toString() == id) { m_downloads.removeAt(i); break; }
    }
    else if (ch == "download:open-file") QDesktopServices::openUrl(QUrl::fromLocalFile(arg.toString()));
    else if (ch == "download:open-folder") QDesktopServices::openUrl(QUrl::fromLocalFile(QFileInfo(arg.toString()).absolutePath()));
    else if (ch == "window:open-address-dialog") emit openWindow("address", QJsonValue());
    else if (ch == "window:open-playlist") emit openWindow("playlist", arg);
    else if (ch == "window:open-settings") emit openWindow("settings", QJsonValue());
    else if (ch == "window:open-extension-setup") emit openWindow("extension-setup", QJsonValue());
    else if (ch == "window:open-scheduler") emit openWindow("scheduler", arg);
    else if (ch == "window:open-properties") emit openWindow("properties", arg);
    else if (ch == "progress:open") emit openWindow("progress", arg);
    else if (ch == "window:close") { qApp->setProperty("zdm_quit", true); qApp->quit(); }
}
