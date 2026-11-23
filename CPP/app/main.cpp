#include "AppUpdate.h"
#include "EngineBridge.h"
#include "MainWindow.h"
#include "Dialogs.h"
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QStandardPaths>
#include <QTimer>

int main(int argc, char** argv) {
    QGuiApplication::setHighDpiScaleFactorRoundingPolicy(Qt::HighDpiScaleFactorRoundingPolicy::PassThrough);
    QApplication app(argc, argv);
    app.setApplicationName("ZettaDM");
    app.setApplicationVersion(QStringLiteral(ZETTA_VERSION));
    app.setOrganizationName("Zetta");
    app.setWindowIcon(QIcon(Theme::assetPath("icons/app.ico")));
    app.setFont(Theme::uiFont(13));                         // body { font-size: 13px }
    app.setQuitOnLastWindowClosed(false);                   // closing the window hides to the tray

    // --demo keeps the sample list. Anything else talks to the C++ engine.
    Bridge* bridge = app.arguments().contains("--demo")
                         ? static_cast<Bridge*>(new MockBridge(true))
                         : static_cast<Bridge*>(new EngineBridge());
    Store store(bridge);
    QueueEngine engine(&store);
    Theme::I().apply(store.settings().value("appearance").toObject());
    QObject::connect(bridge, &Bridge::event, [](const QString& ch, const QJsonValue& v) {
        if (ch == "appearance:changed") Theme::I().apply(v.toObject());
    });

    WindowManager windows(&store, &engine);
    MainWindow w(&store, &engine);
    const bool startInTray = store.settings().value("launch").toObject().value("startMinimized").toBool();
    if (!startInTray) w.show();
    QTimer::singleShot(500, &w, [&windows] {
        QString roaming = qEnvironmentVariable("APPDATA");
        if (roaming.isEmpty())
            roaming = QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation);
        const auto hasSettings = [](const QString& dir) {
            return QFileInfo::exists(QDir(dir).filePath("settings.json"));
        };
        const bool alreadyUsed = hasSettings(QDir(roaming).filePath("Zetta Download Manager"))
                                 || hasSettings(QDir(roaming).filePath("flash-download-manager"))
                                 || hasSettings(QDir(roaming).filePath("Flash Download Manager"));
        const QString userData = QDir(roaming).filePath("Zetta Download Manager");
        const QString seen = QDir(userData).filePath("extension-setup.seen");
        const QString marker = QDir(QCoreApplication::applicationDirPath()).filePath("extension-setup.pending");
        const bool justInstalled = QFileInfo::exists(marker);
        const bool firstLaunch = !alreadyUsed && !QFileInfo::exists(seen);
        if (!justInstalled && !firstLaunch) return;
        QFile::remove(marker);
        QDir().mkpath(userData);
        QFile flag(seen);
        if (flag.open(QIODevice::WriteOnly)) flag.close();
        windows.open("extension-setup", QJsonValue());
    });
    QTimer::singleShot(2000, &w, [&w] { checkForUpdate(&w); });
    return app.exec();
}
