#pragma once
#include "Widgets.h"
#include "Store.h"
#include "DownloadList.h"

class ToolBtn; class CaretBtn; class Sidebar;

// index.html + app.js
class MainWindow : public FramelessWindow {
    Q_OBJECT
public:
    MainWindow(Store* s, QueueEngine* q);
    void refresh();                                   // renderList()
    void applySavedSort();
    void quitApp();                                   // tray Exit and scheduler exit
protected:
    void closeEvent(QCloseEvent*) override;
private:
    QVector<QJsonObject> filtered() const;
    bool isPlaylistDownload(const QJsonObject& item, const QString& url) const;
    QVector<QJsonObject> selected() const;
    void updateToolbar();
    void onRowClicked(const QString& id, Qt::KeyboardModifiers m);
    void onContext(const QString& id, const QPoint& g);
    void onSort(const QString& col);
    void openDeleteMenu();
    void applyDeleteChoice(bool deleteFiles);
    void openQueueMenu(QWidget* anchor, bool start);
    void selectAll();
    void removeSelectedConfirm();
    void setupTray();
    void showFromTray();

    Store* m_s; QueueEngine* m_q;
    DownloadList* m_list; Sidebar* m_side;
    QString m_cat = "all", m_sortCol; bool m_sortAsc = true;
    QHash<QString, ToolBtn*> m_btn;
    QStringList m_order;                              // visible ids, for shift-click
    QString m_lastSel;
    QVector<QJsonObject> m_playlists;
    bool m_allowQuit = false;
    QSystemTrayIcon* m_tray = nullptr;
};
