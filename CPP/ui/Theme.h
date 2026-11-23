#pragma once
// Port of index.css (:root + html[data-theme=...]) and theme.js
#include <QtWidgets>
#include <functional>

struct Tokens {
    QColor bg1, bg2, bg3, hover, active, card;          // --bg-primary .. --bg-card
    QColor accent, accentDim, glow, ok, warn, danger;   // --accent, --accent-dim, --accent-glow, --success ...
    QColor t1, t2, muted, border, border2, edge;        // --text-*, --border, --border-light, html inset 1px
    QColor navBg, navFg;                                // .tree-item.active / .settings-nav-item.active
};

// Which CSS context an icon is drawn in (decides folder + filter exactly like theme.js / index.css)
enum class Use { Toolbar, TreeOn, TreeOff, Empty, Plain };
using GradStops = QVector<QPair<qreal, QColor>>;

class Theme : public QObject {
    Q_OBJECT
public:
    static Theme& I();
    void apply(const QJsonObject& appearance);          // = applyAppearance()
    void setIconSaturation(int percent);                // icon cache only, no stylesheet rebuild
    const Tokens& t() const { return m_t; }
    const QString& id() const { return m_id; }
    bool lines() const { return m_lines; }
    bool is3() const { return m_id == "theme3"; }

    QBrush accentBrush(const QRectF& r) const;          // var(--accent-gradient) over r
    QBrush selBrush(const QRectF& r) const;             // .download-row.selected
    void paintNavActive(QPainter* p, const QRectF& r, qreal radius) const;
    QPixmap icon(const QString& rel, Use use, int logical, bool disabled = false) const;

    static QPixmap fileIcon(const QString& pathOrName, int logical);
    static QLinearGradient cssGradient(const QRectF& r, qreal deg, const GradStops& s);
    static QColor mul(const QColor& c, qreal k);        // filter: brightness(k)
    static QColor over(const QColor& top, const QColor& under);
    static QColor mixc(const QColor& a, const QColor& b, qreal t);
    static QString assetPath(const QString& rel);
    static QFont uiFont(int px, int weight = 400);

signals:
    void changed();

private:
    Theme() = default;
    QString qss() const;
    Tokens m_t;
    QString m_id = "theme3";
    bool m_lines = false;
    int m_sat = 100;
    mutable QHash<QString, QPixmap> m_cache;
};
