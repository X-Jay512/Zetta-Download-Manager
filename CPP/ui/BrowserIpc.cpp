#include "BrowserIpc.h"

#include "zdm_str.hpp"

#include "browser_extension.h"
#include "browsers.h"
#include "server.h"

#include <QClipboard>
#include <QCoreApplication>
#include <QDesktopServices>
#include <QDir>
#include <QFileInfo>
#include <QGuiApplication>
#include <QJsonDocument>
#include <QProcess>
#include <QThread>
#include <QUrl>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <shellapi.h>

namespace zdmui {
namespace {

QJsonValue fromJson(const nlohmann::json& value) {
    const std::string wrapped = "[" + value.dump() + "]";
    const QJsonDocument doc = QJsonDocument::fromJson(QByteArray::fromStdString(wrapped));
    if (!doc.isArray() || doc.array().isEmpty()) return QJsonValue();
    return doc.array().at(0);
}

QJsonObject asObject(const nlohmann::json& value) {
    const QJsonValue parsed = fromJson(value);
    return parsed.isObject() ? parsed.toObject() : QJsonObject();
}

QStringList shareRoots() {
    QStringList roots;
    auto add = [&](const QString& path) {
        if (path.isEmpty()) return;
        const QString clean = QDir(path).absolutePath();
        if (!roots.contains(clean, Qt::CaseInsensitive)) roots.append(clean);
    };
    QDir dir(QCoreApplication::applicationDirPath());
    add(dir.absolutePath());
    for (int i = 0; i < 6 && dir.cdUp(); ++i) add(dir.absolutePath());
#ifdef ZDM_SHARE_ROOT
    add(QString::fromUtf8(ZDM_SHARE_ROOT));
#endif
    return roots;
}

std::filesystem::path extensionDir() {
    for (const QString& root : shareRoots()) {
        const QString manifest = QDir(root).filePath("ext/manifest.json");
        if (QFileInfo::exists(manifest)) return std::filesystem::path(QFileInfo(manifest).dir().absolutePath().toStdWString());
    }
    return std::filesystem::path(QDir(QCoreApplication::applicationDirPath()).filePath("ext").toStdWString());
}

QString firefoxManifest() {
    for (const QString& root : shareRoots()) {
        const QString manifest = QDir(root).filePath("ext f/manifest.json");
        if (QFileInfo::exists(manifest)) return QFileInfo(manifest).absoluteFilePath();
    }
    return QDir(shareRoots().value(0)).filePath("ext f/manifest.json");
}

QString guideFile(const QString& name) {
    const QString file = QFileInfo(name).fileName();
    if (file.isEmpty() || file != name || !file.endsWith(".html", Qt::CaseInsensitive)) return {};
    for (const QString& root : shareRoots()) {
        const QString full = QDir(root).filePath("guid/" + file);
        if (QFileInfo::exists(full)) return QFileInfo(full).absoluteFilePath();
    }
    return {};
}

QString browserExe(const QString& id, const QJsonObject& row) {
    const QString listed = row.value("exe").toString();
    if (!listed.isEmpty() && QFileInfo::exists(listed)) return listed;
    const std::filesystem::path found = zdm::getBrowserExe(id.toStdString());
    return found.empty() ? QString() : QString::fromStdWString(found.wstring());
}

QJsonObject openBrowser(const QString& exe, const QStringList& args) {
    if (exe.isEmpty() || !QFileInfo::exists(exe)) {
        return QJsonObject{{"ok", false}, {"error", "The browser program was not found on this computer."}};
    }
    if (!QProcess::startDetached(exe, args)) {
        return QJsonObject{{"ok", false}, {"error", "The browser did not open."}};
    }
    return QJsonObject{{"ok", true}, {"openedPage", true}};
}

QJsonObject decorate(const zdm::InstalledBrowser& browser, const std::filesystem::path& extDir) {
    QJsonObject row = asObject(browser.toJson());
    const bool known = zdm::browsers().find(browser.id) != zdm::browsers().end();
    row["installable"] = known;
    nlohmann::json status = nlohmann::json::object({{"enabled", false}});
    try {
        status = zdm::extensionStatus(browser.id, extDir);
    } catch (...) {
        status = nlohmann::json::object({{"enabled", false}});
    }
    const QJsonObject extension = asObject(status);
    row["extension"] = extension;
    row["connected"] = extension.value("enabled").toBool();
    return row;
}

}  // namespace

QJsonArray scanBrowsers(const QJsonArray& previous) {
    std::vector<zdm::InstalledBrowser> prior;
    for (const auto& item : previous) {
        const QJsonObject row = item.toObject();
        zdm::InstalledBrowser browser;
        browser.id = row.value("id").toString().toStdString();
        browser.enabled = row.value("enabled").toBool(true);
        if (!browser.id.empty()) prior.push_back(std::move(browser));
    }
    const std::filesystem::path extDir = extensionDir();
    QJsonArray found;
    for (const zdm::InstalledBrowser& browser : zdm::scanInstalledBrowsers(prior)) found.append(decorate(browser, extDir));
    return found;
}

QJsonArray browserStatus(const QJsonArray& detected) {
    const std::filesystem::path extDir = extensionDir();
    QJsonArray out;
    for (const auto& item : detected) {
        const QJsonObject row = item.toObject();
        const std::string id = row.value("id").toString().toStdString();
        nlohmann::json status = nlohmann::json::object({{"enabled", false}});
        try {
            if (!id.empty()) status = zdm::extensionStatus(id, extDir);
        } catch (...) {
            status = nlohmann::json::object({{"enabled", false}});
        }
        const QJsonObject extension = asObject(status);
        out.append(QJsonObject{{"id", row.value("id")}, {"connected", extension.value("enabled").toBool()}, {"extension", extension}});
    }
    return out;
}

QJsonObject installBrowser(const QString& browserId, const QJsonObject& row, const std::filesystem::path& userData, zdm::NativeHostServer* host) {
    const QString id = browserId.trimmed().toLower();
    const std::string sid = id.toStdString();
    const QString family = row.value("family").toString();
    const QString exe = browserExe(id, row);
    const bool known = zdm::browsers().find(sid) != zdm::browsers().end();
    const bool firefox = family == "firefox" || (known && zdm::browsers().at(sid).firefox);
    const std::filesystem::path extDir = extensionDir();

    if (id == "chrome") return openBrowser(exe, {"chrome://extensions"});
    if (firefox) {
        const QString url = QString::fromUtf8(zdm::kFirefoxStoreUrl());
        const QString storeName = QStringLiteral("Firefox Add-ons");
        if (!exe.isEmpty() && QFileInfo::exists(exe) && QProcess::startDetached(exe, {url})) {
            return QJsonObject{{"ok", true}, {"openedStore", true}, {"store", "firefox"}, {"storeName", storeName}};
        }
        ShellExecuteW(nullptr, L"open", reinterpret_cast<LPCWSTR>(url.utf16()), nullptr, nullptr, SW_SHOWNORMAL);
        return QJsonObject{{"ok", true}, {"openedStore", true}, {"store", "firefox"}, {"storeName", storeName}};
    }

    if (family == "chromium" && !known) {
        const QString manifest = QString::fromStdWString((extDir / L"manifest.json").wstring());
        if (!QFileInfo::exists(manifest)) return QJsonObject{{"ok", false}, {"error", "Extension folder was not found."}};
        if (exe.isEmpty()) return QJsonObject{{"ok", false}, {"error", "The browser program was not found on this computer."}};
        QProcess kill;
        kill.start("taskkill", {"/IM", QFileInfo(exe).fileName()});
        kill.waitForFinished(8000);
        QThread::msleep(600);
        return openBrowser(exe, {QString::fromUtf8(ZDM_STR("--disable-features=DisableLoadExtensionCommandLineSwitch")),
                                 QString::fromUtf8(ZDM_STR("--load-extension=")) + QDir::toNativeSeparators(QString::fromStdWString(extDir.wstring())),
                                 "chrome://extensions"});
    }

    if (!known) {
        const QString storeName = row.value("storeName").toString().isEmpty() ? QString("the browser store") : row.value("storeName").toString();
        const QString storeUrl = row.value("storeUrl").toString();
        if (!storeUrl.isEmpty()) {
            ShellExecuteW(nullptr, L"open", reinterpret_cast<LPCWSTR>(storeUrl.utf16()), nullptr, nullptr, SW_SHOWNORMAL);
            return QJsonObject{{"ok", true}, {"openedStore", true}, {"store", row.value("store")}, {"storeName", storeName}};
        }
        return QJsonObject{{"ok", false}, {"error", QString("This browser uses %1.").arg(storeName)}, {"store", row.value("store")}, {"storeName", storeName}};
    }

    zdm::InstallOptions opts;
    opts.exe = std::filesystem::path(exe.toStdWString());
    opts.extDir = extDir;
    opts.userData = userData;
    opts.setDist = [host](const std::filesystem::path& dir) {
        if (host) host->setExtensionDist(zdm::u8(dir));
    };
    opts.isConnected = [host, sid] { return host && host->isBrowserConnected(sid); };
    const zdm::InstallResult result = zdm::installExtension(sid, opts);
    QJsonObject out = asObject(result.toJson());
    QJsonObject extension = asObject(zdm::extensionStatus(sid, extDir));
    out["connected"] = out.value("connected").toBool() || extension.value("enabled").toBool();
    out["extension"] = extension;
    return out;
}

QJsonObject copyExtensionPath(const QString& kind) {
    const QString target = kind == "manifest"
                               ? QDir::toNativeSeparators(firefoxManifest())
                               : QDir::toNativeSeparators(QString::fromStdWString(extensionDir().wstring()));
    if (QGuiApplication::clipboard()) QGuiApplication::clipboard()->setText(target);
    return QJsonObject{{"ok", true}, {"path", target}};
}

QJsonObject openGuide(const QString& name) {
    const QString full = guideFile(name);
    if (full.isEmpty()) return QJsonObject{{"ok", false}, {"error", "Guide was not found."}};
    if (!QDesktopServices::openUrl(QUrl::fromLocalFile(full))) {
        return QJsonObject{{"ok", false}, {"error", "The guide did not open."}};
    }
    return QJsonObject{{"ok", true}};
}

QJsonObject copyGuideText(const QString& text) {
    if (text != "chrome://extensions") return QJsonObject{{"ok", false}, {"error", "Nothing to copy."}};
    if (QGuiApplication::clipboard()) QGuiApplication::clipboard()->setText(text);
    return QJsonObject{{"ok", true}};
}

}  // namespace zdmui
