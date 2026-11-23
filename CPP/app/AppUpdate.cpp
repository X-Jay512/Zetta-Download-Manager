#include "AppUpdate.h"
#include "Widgets.h"

#include <QApplication>
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMessageBox>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QProcess>
#include <QProgressDialog>
#include <QStandardPaths>
#include <QUrl>

namespace {

const char* kReleaseUrl = "https://api.github.com/repos/X-Jay512/Zetta-Download-Manager/releases/latest";

#ifndef ZETTA_VERSION
#define ZETTA_VERSION "1.0.0"
#endif

QVector<int> versionParts(QString text) {
    if (text.startsWith('v') || text.startsWith('V')) text.remove(0, 1);
    int end = 0;
    while (end < text.size() && (text[end].isDigit() || text[end] == '.')) ++end;
    text.truncate(end);
    QVector<int> parts;
    for (const QString& piece : text.split('.', Qt::SkipEmptyParts)) parts.push_back(piece.toInt());
    while (parts.size() < 3) parts.push_back(0);
    return parts;
}

bool isNewer(const QString& remote, const QString& local) {
    const QVector<int> next = versionParts(remote);
    const QVector<int> have = versionParts(local);
    const int count = qMax(next.size(), have.size());
    for (int i = 0; i < count; ++i) {
        const int a = i < next.size() ? next[i] : 0;
        const int b = i < have.size() ? have[i] : 0;
        if (a != b) return a > b;
    }
    return false;
}

QString setupUrl(const QJsonArray& assets) {
    QString fallback;
    for (const QJsonValue& value : assets) {
        const QJsonObject asset = value.toObject();
        const QString name = asset.value("name").toString();
        const QString url = asset.value("browser_download_url").toString();
        if (!name.endsWith(".exe", Qt::CaseInsensitive) || url.isEmpty()) continue;
        if (name.contains("Setup", Qt::CaseInsensitive)) return url;
        if (fallback.isEmpty()) fallback = url;
    }
    return fallback;
}

QNetworkRequest githubRequest(const QUrl& url) {
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, "ZettaDM");
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    return request;
}

void downloadSetup(QWidget* parent, QNetworkAccessManager* net, const QString& url, const QString& version) {
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::TempLocation) + "/ZettaDM-update";
    QDir().mkpath(dir);
    const QString path = dir + "/ZettaDM-Setup-" + version + ".exe";
    auto* file = new QFile(path);
    if (!file->open(QIODevice::WriteOnly)) {
        delete file;
        askBox(parent, QMessageBox::Warning, "Update", "Could not save the installer.", QMessageBox::Ok);
        return;
    }

    QNetworkReply* reply = net->get(githubRequest(QUrl(url)));
    auto* progress = new QProgressDialog("Downloading update...", "Cancel", 0, 0, parent);
    progress->setWindowTitle("Update");
    progress->setAutoClose(false);
    progress->setMinimumDuration(0);

    QObject::connect(progress, &QProgressDialog::canceled, reply, &QNetworkReply::abort);
    QObject::connect(reply, &QNetworkReply::downloadProgress, progress, [progress](qint64 got, qint64 total) {
        if (total > 0) { progress->setMaximum(100); progress->setValue(int(got * 100 / total)); }
    });
    QObject::connect(reply, &QNetworkReply::readyRead, file, [reply, file] { file->write(reply->readAll()); });
    QObject::connect(reply, &QNetworkReply::finished, parent, [parent, reply, file, progress, path] {
        progress->close();
        progress->deleteLater();
        file->close();
        const bool ok = reply->error() == QNetworkReply::NoError && file->size() > 0;
        reply->deleteLater();
        file->deleteLater();
        if (!ok) {
            QFile::remove(path);
            if (reply->error() != QNetworkReply::OperationCanceledError)
                askBox(parent, QMessageBox::Warning, "Update", "The download did not finish.", QMessageBox::Ok);
            return;
        }
        if (!QProcess::startDetached(path, {})) {
            askBox(parent, QMessageBox::Warning, "Update", "The installer was saved but did not start.", QMessageBox::Ok);
            return;
        }
        QApplication::quit();
    });
}

} // namespace

void checkForUpdate(QWidget* parent) {
    auto* net = new QNetworkAccessManager(parent);
    QNetworkReply* reply = net->get(githubRequest(QUrl(QString::fromLatin1(kReleaseUrl))));
    QObject::connect(reply, &QNetworkReply::finished, parent, [parent, net, reply] {
        reply->deleteLater();
        if (reply->error() != QNetworkReply::NoError) return;
        const QJsonObject release = QJsonDocument::fromJson(reply->readAll()).object();
        if (release.value("prerelease").toBool()) return;
        const QString tag = release.value("tag_name").toString();
        const QString url = setupUrl(release.value("assets").toArray());
        if (tag.isEmpty() || url.isEmpty() || !isNewer(tag, QStringLiteral(ZETTA_VERSION))) return;
        const auto choice = askBox(parent, QMessageBox::Question, "Update",
            QString("Version %1 is available. This copy is %2.\n\nDownload and install it?")
                .arg(tag, QStringLiteral(ZETTA_VERSION)),
            QMessageBox::Yes | QMessageBox::No, QMessageBox::Yes);
        if (choice == QMessageBox::Yes) downloadSetup(parent, net, url, tag);
    });
}
