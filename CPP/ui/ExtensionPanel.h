#pragma once
#include "Store.h"
#include "Widgets.h"

class ExtensionPanel : public QWidget {
    Q_OBJECT
public:
    ExtensionPanel(Bridge* bridge, const QJsonArray& initial, QWidget* parent = nullptr);
    void setRows(const QJsonArray& rows);
    void refreshStatus();

signals:
    void rowsChanged(const QJsonArray& rows);

private:
    void paintRows();
    void scan();
    void remember();
    void install(PushButton* button, const QJsonObject& row);
    void showGuideNote(const QString& text);
    Bridge* m_b;
    QJsonArray m_rows;
    QVBoxLayout* m_list = nullptr;
    QTimer m_timer;
    PushButton* m_scan = nullptr;
    QLabel* m_note = nullptr;
};

class ExtensionSetup : public FramelessWindow {
    Q_OBJECT
public:
    explicit ExtensionSetup(Store* store);
};
