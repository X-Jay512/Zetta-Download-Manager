#include "Theme.h"
#include <cmath>

static QColor rgba(int r, int g, int b, double a) { return QColor::fromRgbF(r / 255.0, g / 255.0, b / 255.0, a); }
static QString css(const QColor& c) {
    return QString("rgba(%1,%2,%3,%4)").arg(c.red()).arg(c.green()).arg(c.blue()).arg(c.alpha());
}

Theme& Theme::I() { static Theme t; return t; }

QColor Theme::mul(const QColor& c, qreal k) {
    return QColor(qMin(255, int(c.red() * k + .5)), qMin(255, int(c.green() * k + .5)),
                  qMin(255, int(c.blue() * k + .5)), c.alpha());
}
QColor Theme::over(const QColor& top, const QColor& under) {
    qreal a = top.alphaF();
    return QColor::fromRgbF(top.redF() * a + under.redF() * (1 - a), top.greenF() * a + under.greenF() * (1 - a),
                            top.blueF() * a + under.blueF() * (1 - a), 1.0);
}
QColor Theme::mixc(const QColor& a, const QColor& b, qreal t) {
    return QColor::fromRgbF(a.redF() * (1 - t) + b.redF() * t, a.greenF() * (1 - t) + b.greenF() * t,
                            a.blueF() * (1 - t) + b.blueF() * t, 1.0);
}
QFont Theme::uiFont(int px, int weight) {
    QFont f;
    f.setFamilies({"Inter", "Segoe UI"});   // the @import of Inter in index.css sits after other rules, so the browser ignored it
    f.setPixelSize(px);
    f.setWeight(QFont::Weight(weight));
    return f;
}
QString Theme::assetPath(const QString& rel) {
    const QString a = QCoreApplication::applicationDirPath() + "/assets/" + rel;
    if (QFileInfo::exists(a)) return a;
    return QDir::currentPath() + "/assets/" + rel;
}

// CSS linear-gradient(angle, stops) over a box: same geometry the browser uses
QLinearGradient Theme::cssGradient(const QRectF& r, qreal deg, const GradStops& s) {
    const qreal a = qDegreesToRadians(deg);
    const QPointF dir(std::sin(a), -std::cos(a));
    const qreal len = std::abs(r.width() * std::sin(a)) + std::abs(r.height() * std::cos(a));
    const QPointF c = r.center();
    QLinearGradient g(c - dir * (len / 2), c + dir * (len / 2));
    for (const auto& st : s) g.setColorAt(st.first, st.second);
    return g;
}

void Theme::apply(const QJsonObject& a) {
    QString id = a.value("theme").toString("theme1");
    if (id != "theme2" && id != "theme3" && id != "theme4") id = "theme1";
    m_id = id;
    m_lines = a.value("columnLines").toBool(false);
    const double rawSat = a.value("iconSaturation").toDouble(100);
    m_sat = qBound(0, int(std::lround(rawSat)), 100);

    Tokens t;
    // :root (theme1 and the base of theme3 / theme4)
    t.bg1 = "#1e1f22"; t.bg2 = "#18191c"; t.bg3 = "#141416"; t.hover = "#2a2b2f"; t.active = "#32343a"; t.card = "#232428";
    t.accent = "#6e9ed4"; t.accentDim = "#6e9ed4"; t.glow = rgba(110, 158, 212, .16);
    t.ok = "#00e676"; t.warn = "#ffab40"; t.danger = "#ff5252";
    t.t1 = "#f3f3f4"; t.t2 = "#c6c7cc"; t.muted = "#8d8e96"; t.border = "#3a3c42"; t.border2 = "#4a4c54";
    t.edge = "#3e4046";
    t.navBg = rgba(110, 158, 212, .16); t.navFg = "#6e9ed4";
    if (id == "theme2") {
        t.bg1 = "#f6f7fb"; t.bg2 = "#eef1f6"; t.bg3 = "#e6ebf3"; t.hover = "#dde3ee"; t.active = "#d3dbeb"; t.card = "#fbfcfe";
        t.accent = "#4f66e6"; t.accentDim = "#6d82ee"; t.glow = rgba(79, 102, 230, .14);
        t.t1 = "#1c2230"; t.t2 = "#3c455c"; t.muted = "#6d7690"; t.border = "#d5dbe8"; t.border2 = "#c5cedd";
        t.ok = "#128a62"; t.warn = "#a56b12"; t.danger = "#c44545";
        t.edge = "#7a7a7a";
        t.navBg = rgba(79, 102, 230, .12); t.navFg = "#4f66e6";
    } else if (id == "theme3") {
        t.accent = "#60a6d9"; t.accentDim = "#b85dff"; t.glow = rgba(184, 93, 255, .18);
        t.ok = "#45b36b"; t.warn = "#f6c244"; t.danger = "#ea4c3c";
        t.navFg = "#eff2f6";
    } else if (id == "theme4") {
        t.accent = "#e15d5d"; t.accentDim = "#e15d5d"; t.glow = rgba(225, 93, 93, .16);
        t.navBg = rgba(225, 93, 93, .16); t.navFg = "#e15d5d";
    }
    m_t = t;
    m_cache.clear();
    QPalette pal = qApp->palette();
    pal.setColor(QPalette::Window, t.bg2);
    pal.setColor(QPalette::WindowText, t.t1);
    pal.setColor(QPalette::Base, t.bg1);
    pal.setColor(QPalette::AlternateBase, t.bg2);
    pal.setColor(QPalette::ToolTipBase, t.card);
    pal.setColor(QPalette::ToolTipText, t.t1);
    pal.setColor(QPalette::Text, t.t1);
    pal.setColor(QPalette::Button, t.active);
    pal.setColor(QPalette::ButtonText, t.t1);
    pal.setColor(QPalette::BrightText, Qt::white);
    pal.setColor(QPalette::Highlight, t.accent);
    pal.setColor(QPalette::HighlightedText, Qt::white);
    qApp->setPalette(pal);
    qApp->setStyleSheet(qss());
    emit changed();
}

void Theme::setIconSaturation(int percent) {
    percent = qBound(0, percent, 100);
    if (percent == m_sat) return;
    m_sat = percent;
    m_cache.clear();
    emit changed();
}

QBrush Theme::accentBrush(const QRectF& r) const {
    if (m_id == "theme2")
        return QBrush(cssGradient(r, 135, {{0, QColor("#5b73ea")}, {1, QColor("#4f66e6")}}));
    if (m_id == "theme3")
        return QBrush(cssGradient(r, 100, {{0, QColor("#00d2ff")}, {.35, QColor("#60a6d9")}, {.70, QColor("#b85dff")}, {1, QColor("#ff00fc")}}));
    return QBrush(m_t.accent);
}

QBrush Theme::selBrush(const QRectF& r) const {
    if (m_id == "theme3")
        return QBrush(cssGradient(r, 90, {{0, rgba(0, 210, 255, .2)}, {1, rgba(184, 93, 255, .18)}}));
    return QBrush(m_t.glow);
}

void Theme::paintNavActive(QPainter* p, const QRectF& r, qreal radius) const {
    p->save();
    QPainterPath path; path.addRoundedRect(r, radius, radius);
    p->setClipPath(path, Qt::IntersectClip);
    const QRectF bar(r.left(), r.top(), 3, r.height());
    if (m_id == "theme3") {
        p->fillRect(r, cssGradient(r, 90, {{0, rgba(71, 145, 191, .22)}, {1, rgba(184, 93, 255, .16)}}));
        p->fillRect(bar, cssGradient(bar, 180, {{0, QColor("#00d2ff")}, {.35, QColor("#60a6d9")}, {.70, QColor("#b85dff")}, {1, QColor("#ff00fc")}}));
    } else {
        p->fillRect(r, m_t.navBg);
        p->fillRect(bar, m_t.navFg);     // box-shadow: inset 3px 0 0
    }
    p->restore();
}

// ---------------------------------------------------------------- icons
static const QSet<QString> kT2 = {"add-playlist.png", "add-url.png", "all-downloads.png", "compress.png", "delete.png",
    "documents.png", "download.png", "finished.png", "main-queues.png", "open-folder.png", "options.png", "queues.png",
    "resume.png", "scheduler.png", "start-queue.png", "stop-all.png", "stop-queue.png", "stop.png", "sync.png",
    "unfinished.png", "video.png", "grabber.png", "music.png", "programs.png"};
static const QSet<QString> kXj = {"add-playlist.png", "add-url.png", "all-downloads.png", "compress.png", "delete.png",
    "docs.png", "documents.png", "download.png", "finished.png", "grabber-projects.png", "grabber.png", "main-queues.png",
    "music.png", "open-folder.png", "options.png", "programs.png", "queues.png", "resume.png", "scheduler.png",
    "start-queue.png", "stop-all.png", "stop-queue.png", "stop.png", "sync.png", "unfinished.png", "video.png"};

static void tintImg(QImage& im, const QColor& c) {          // feColorMatrix constant colour, alpha kept
    QPainter p(&im); p.setCompositionMode(QPainter::CompositionMode_SourceIn); p.fillRect(im.rect(), c);
}
static void grayImg(QImage& im, qreal k) {                  // grayscale(1) brightness(k)
    for (int y = 0; y < im.height(); ++y) {
        QRgb* l = reinterpret_cast<QRgb*>(im.scanLine(y));
        for (int x = 0; x < im.width(); ++x) {
            const qreal g = qMin(255.0, (0.2126 * qRed(l[x]) + 0.7152 * qGreen(l[x]) + 0.0722 * qBlue(l[x])) * k);
            l[x] = qRgba(int(g), int(g), int(g), qAlpha(l[x]));
        }
    }
}
static void satImg(QImage& im, qreal s) {                   // saturate(s)
    for (int y = 0; y < im.height(); ++y) {
        QRgb* l = reinterpret_cast<QRgb*>(im.scanLine(y));
        for (int x = 0; x < im.width(); ++x) {
            const qreal r = qRed(l[x]), g = qGreen(l[x]), b = qBlue(l[x]);
            const qreal nr = (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b;
            const qreal ng = (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b;
            const qreal nb = (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b;
            l[x] = qRgba(qBound(0, int(nr), 255), qBound(0, int(ng), 255), qBound(0, int(nb), 255), qAlpha(l[x]));
        }
    }
}
static QImage withOpacity(const QImage& im, qreal o) {
    QImage out(im.size(), QImage::Format_ARGB32_Premultiplied); out.fill(0);
    QPainter p(&out); p.setOpacity(o); p.drawImage(0, 0, im); p.end();
    return out.convertToFormat(QImage::Format_ARGB32);
}

QPixmap Theme::icon(const QString& rel, Use use, int logical, bool disabled) const {
    const QString key = QString("%1|%2|%3|%4|%5|%6").arg(rel).arg(int(use)).arg(logical).arg(disabled).arg(m_id).arg(m_sat);
    auto it = m_cache.constFind(key);
    if (it != m_cache.constEnd()) return *it;

    const bool num = rel.startsWith("num/");
    const QString file = num ? rel.mid(4) : rel;
    QString folder;
    if (num) {
        folder = (m_id == "theme3" && use != Use::TreeOff) ? "xjay/num" : "num";
    } else if (m_id == "theme3") {
        if (use == Use::TreeOff) folder = kT2.contains(file) ? "theme2" : "";
        else folder = kXj.contains(file) ? "xjay" : "";
    } else {
        folder = kT2.contains(file) ? ((m_id == "theme1" || m_id == "theme4") ? "theme2" : "theme3") : "";
    }
    const QString path = assetPath("ui/" + (folder.isEmpty() ? QString() : folder + "/") + file);

    QImage im(path);
    if (im.isNull()) return QPixmap();
    const qreal dpr = qApp->devicePixelRatio();
    im = im.convertToFormat(QImage::Format_ARGB32)
             .scaled(QSize(logical, logical) * dpr, Qt::KeepAspectRatio, Qt::SmoothTransformation);

    const bool t14 = (m_id == "theme1" || m_id == "theme4");
    const QColor tint = (m_id == "theme4") ? QColor("#e15d5d") : QColor("#6e9ed4");   // #fdm-icon-red / #fdm-icon-blue
    qreal opacity = 1.0;
    auto saturate = [&] { if (m_sat != 100) satImg(im, m_sat / 100.0); };

    switch (use) {
    case Use::Toolbar:
        if (disabled) {
            if (t14) { grayImg(im, 0.65); opacity = 0.4; }
            else if (m_id == "theme2") opacity = 0.38;
            else opacity = 0.4;
        } else if (t14) tintImg(im, tint);
        else if (m_id == "theme3") saturate();
        break;
    case Use::TreeOn:
    case Use::Plain:
        if (t14) tintImg(im, tint); else if (m_id == "theme3") saturate();
        break;
    case Use::TreeOff:
        if (m_id == "theme2") opacity = 0.45;
        else tintImg(im, QColor(140, 140, 140));                // brightness(0) invert(.55)
        break;
    case Use::Empty:
        if (t14) tintImg(im, tint);
        else if (m_id == "theme2") opacity = 0.45;
        else { saturate(); opacity = 0.92; }
        break;
    }
    if (opacity < 1.0) im = withOpacity(im, opacity);
    QPixmap pm = QPixmap::fromImage(im);
    pm.setDevicePixelRatio(dpr);
    m_cache.insert(key, pm);
    return pm;
}

QPixmap Theme::fileIcon(const QString& pathOrName, int logical) {
    static QFileIconProvider prov;
    return prov.icon(QFileInfo(pathOrName.isEmpty() ? QStringLiteral("file.bin") : pathOrName)).pixmap(logical, logical);
}

// ---------------------------------------------------------------- QSS
static QString glyph(const QString& name, QSize sz, const std::function<void(QPainter&)>& draw) {
    QImage im(sz * 2, QImage::Format_ARGB32_Premultiplied); im.fill(0);
    QPainter p(&im); p.setRenderHint(QPainter::Antialiasing); p.scale(2, 2); draw(p); p.end();
    const QString path = QDir::temp().filePath(name);
    im.save(path, "PNG");
    return QDir::fromNativeSeparators(path);
}

QString Theme::qss() const {
    const Tokens& t = m_t;
    const QString chev = glyph("zdm_chev_" + m_id + ".png", {10, 6}, [&](QPainter& p) {
        p.setPen(QPen(t.t1, 1.6, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
        p.drawPolyline(QPolygonF({{1, 1}, {5, 5}, {9, 1}}));
    });
    const QString caret = glyph("zdm_caret_" + m_id + ".png", {10, 10}, [&](QPainter& p) {
        p.setPen(Qt::NoPen); p.setBrush(t.muted);
        p.drawPolygon(QPolygonF({{3, 1}, {7, 5}, {3, 9}}));
    });
    QMap<QString, QString> k = {
        {"bg1", css(t.bg1)}, {"bg2", css(t.bg2)}, {"bg3", css(t.bg3)}, {"hover", css(t.hover)}, {"active", css(t.active)},
        {"card", css(t.card)}, {"accent", css(t.accent)}, {"dim", css(t.accentDim)}, {"glow", css(t.glow)},
        {"ok", css(t.ok)}, {"warn", css(t.warn)}, {"danger", css(t.danger)}, {"t1", css(t.t1)}, {"t2", css(t.t2)},
        {"muted", css(t.muted)}, {"mutedHalf", css(mixc(t.muted, t.card, .5))}, {"border", css(t.border)},
        {"border2", css(t.border2)},
        {"sb", m_id == "theme3" ? "#3a3c42" : css(t.active)}, {"sbh", m_id == "theme3" ? "#5a5c64" : css(t.accentDim)},
        {"chev", chev}, {"caret", caret}};

    QString s = R"(
QToolTip { background:@{card}; color:@{t1}; border:1px solid @{border2}; padding:3px 6px; font-size:12px; }
QLabel { background:transparent; }
QLabel[c="t1"] { color:@{t1}; }      QLabel[c="t2"] { color:@{t2}; }      QLabel[c="muted"] { color:@{muted}; }
QLabel[c="accent"] { color:@{accent}; }  QLabel[c="danger"] { color:@{danger}; }  QLabel[c="ok"] { color:@{ok}; }
QFrame[sep="1"] { background:@{border}; border:none; }
QFrame[sep="2"] { background:@{border2}; border:none; }
QScrollArea { background:transparent; border:none; }
QScrollArea::viewport, QWidget#qt_scrollarea_viewport { background:transparent; }
QScrollArea > QWidget > QWidget { background:transparent; }
QScrollBar:vertical { background:transparent; width:6px; margin:0; }
QScrollBar:horizontal { background:transparent; height:6px; margin:0; }
QScrollBar::handle:vertical { background:@{sb}; border-radius:3px; min-height:24px; }
QScrollBar::handle:horizontal { background:@{sb}; border-radius:3px; min-width:24px; }
QScrollBar::handle:vertical:hover, QScrollBar::handle:horizontal:hover { background:@{sbh}; }
QScrollBar::add-line, QScrollBar::sub-line { width:0; height:0; border:none; background:none; }
QScrollBar::add-page, QScrollBar::sub-page { background:transparent; }
QMenu { background:@{card}; border:1px solid @{border2}; border-radius:4px; padding:4px 0; }
QMenu[sub="1"] { border-radius:8px; }
QMenu::item { padding:6px 16px; font-size:12px; color:@{t1}; background:transparent; }
QMenu::item:selected { background:@{hover}; }
QMenu::item:disabled { color:@{mutedHalf}; background:transparent; }
QMenu::separator { height:1px; background:@{border}; margin:4px 0; }
QMenu[r6="1"] { border-radius:6px; padding:4px; }
QMenu[r6="1"]::item { padding:6px 8px; border-radius:4px; }
QMenu::right-arrow { image:url(@{caret}); width:10px; height:10px; margin-right:6px; }
QComboBox::drop-down { border:none; width:20px; subcontrol-origin:padding; subcontrol-position:center right; }
QComboBox::down-arrow { image:url(@{chev}); width:10px; height:6px; }
QComboBox QAbstractItemView { background-color:@{bg1}; background:@{bg1}; border:1px solid @{border2}; color:@{t1}; selection-background-color:@{hover}; selection-color:@{t1}; outline:0; padding:2px 0; font-size:12px; }
QComboBox QAbstractItemView::viewport { background-color:@{bg1}; background:@{bg1}; color:@{t1}; }
QComboBox QAbstractItemView::item { background-color:@{bg1}; color:@{t1}; padding:5px 10px; min-height:20px; border:none; }
QComboBox QAbstractItemView::item:selected { background-color:@{hover}; color:@{t1}; }
QComboBox QAbstractItemView::item:hover { background-color:@{hover}; color:@{t1}; }
QSlider::groove:horizontal { height:4px; background:@{border2}; border-radius:2px; }
QSlider::sub-page:horizontal { background:@{accent}; border-radius:2px; }
QSlider::handle:horizontal { background:@{accent}; width:16px; height:16px; margin:-6px 0; border-radius:8px; }
)";
    struct V { const char* n; const char* pad; int rad; const char* bd; };
    const V vars[] = {{"info", "5px 8px", 4, "border"}, {"num", "2px 6px", 0, "border2"}, {"addr", "2px 8px", 2, "border2"},
                      {"auth", "2px 8px", 2, "border"}, {"prop", "4px 8px", 4, "border"}, {"set", "7px 10px", 4, "border"},
                      {"studio", "7px 10px", 8, "border"}, {"pl", "5px 8px", 4, "border2"}, {"sel", "2px 6px", 4, "border2"}};
    for (const V& v : vars) {
        const QString n = v.n;
        const QStringList w = {"QLineEdit", "QSpinBox", "QDoubleSpinBox", "QTimeEdit", "QDateEdit", "QComboBox"};
        QStringList sel, selFocus;
        for (const QString& c : w) { sel << QString("%1[v=\"%2\"]").arg(c, n); selFocus << QString("%1[v=\"%2\"]:focus").arg(c, n); }
        s += sel.join(", ") + QString(" { background:@{bg1}; color:@{t1}; border:1px solid @{%1}; border-radius:%2px; padding:%3;"
                                      " selection-background-color:@{accent}; selection-color:#ffffff; font-size:12px; }\n")
                                  .arg(QString(v.bd)).arg(v.rad).arg(QString(v.pad));
        s += selFocus.join(", ") + " { border-color:@{accent}; }\n";
        s += QString("QLineEdit[v=\"%1\"]:read-only { color:@{t2}; }\n").arg(n);
        s += QString("QLineEdit[v=\"%1\"]:disabled, QSpinBox[v=\"%1\"]:disabled, QComboBox[v=\"%1\"]:disabled { background:@{bg3}; color:@{mutedHalf}; }\n").arg(n);
    }
    for (auto it = k.constBegin(); it != k.constEnd(); ++it) s.replace("@{" + it.key() + "}", it.value());
    return s;
}
