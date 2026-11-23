#pragma once
#include "Widgets.h"
#include "Store.h"

// .download-list-header + .download-list (grid with CSS-variable column widths, 2px resizers, sticky header)
class DownloadList : public QAbstractScrollArea {
    Q_OBJECT
public:
    DownloadList(Store* s, QueueEngine* q, QWidget* parent = nullptr);
    void setRows(const QVector<QJsonObject>& rows);
    void setSort(const QString& col, bool asc) { m_sortCol = col; m_asc = asc; viewport()->update(); }
    QSet<QString>& selection() { return m_sel; }
    void repaintRow(const QString& id);
signals:
    void sortClicked(const QString& col);
    void rowClicked(const QString& id, Qt::KeyboardModifiers m);
    void rowDoubleClicked(const QString& id);
    void contextRequested(const QString& id, const QPoint& globalPos);
    void blankClicked();
protected:
    void paintEvent(QPaintEvent*) override;
    void resizeEvent(QResizeEvent*) override { updateBars(); }
    void mousePressEvent(QMouseEvent*) override;
    void mouseMoveEvent(QMouseEvent*) override;
    void mouseReleaseEvent(QMouseEvent*) override;
    void mouseDoubleClickEvent(QMouseEvent*) override;
    void contextMenuEvent(QContextMenuEvent*) override;
    void leaveEvent(QEvent*) override { m_hoverId.clear(); m_hoverCol = -1; viewport()->update(); }
private:
    int rowH() const { return 40 + (Theme::I().lines() ? 1 : 0); }
    int hdrH() const;
    int contentW() const { int w = 0; for (int c : m_w) w += c; return w; }
    int colX(int i) const { int x = -horizontalScrollBar()->value(); for (int k = 0; k < i; ++k) x += m_w[k]; return x; }
    int rowAt(int y) const;
    int headerColAt(int x) const;
    bool onResizer(int x, int col) const;
    void updateBars();
    void drawRow(QPainter& p, const QJsonObject& d, int y, int W);
    void drawHeader(QPainter& p, int W);
    Store* m_s; QueueEngine* m_q;
    QVector<QJsonObject> m_rows;
    QSet<QString> m_sel;
    QVector<int> m_w{44, 240, 36, 90, 130, 80, 100, 168};    // --col-icon .. --col-tried
    QString m_sortCol; bool m_asc = true;
    QString m_hoverId; int m_hoverCol = -1;
    int m_drag = -1, m_dragX = 0, m_dragW = 0;
};
