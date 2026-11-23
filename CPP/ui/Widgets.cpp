#include "Widgets.h"
#include <cmath>
#ifdef Q_OS_WIN
#include <windows.h>
#include <windowsx.h>
#include <dwmapi.h>
#ifndef DWMWA_BORDER_COLOR
#define DWMWA_BORDER_COLOR 34
#endif
#ifndef DWMWA_WINDOW_CORNER_PREFERENCE
#define DWMWA_WINDOW_CORNER_PREFERENCE 33
#endif
#ifndef DWMWCP_ROUND
#define DWMWCP_ROUND 2
#endif
#endif

// =================================================================== helpers
QLabel* makeLabel(const QString& text, int px, int weight, const char* tok, QWidget* parent) {
    auto* l = new QLabel(text, parent);
    l->setFont(Theme::uiFont(px, weight));
    l->setProperty("c", tok);
    l->setTextFormat(Qt::PlainText);
    return l;
}
QMessageBox::StandardButton askBox(QWidget* parent, QMessageBox::Icon icon, const QString& title, const QString& text,
                                    QMessageBox::StandardButtons buttons, QMessageBox::StandardButton def) {
    QMessageBox box(icon, title, QString(), buttons, parent);
    const Tokens& t = Theme::I().t();
    const auto hex = [](const QColor& c) { return c.name(QColor::HexRgb); };
    QPalette pal = box.palette();
    pal.setColor(QPalette::Window, t.card);
    pal.setColor(QPalette::WindowText, t.t1);
    pal.setColor(QPalette::Text, t.t1);
    pal.setColor(QPalette::Base, t.card);
    pal.setColor(QPalette::Button, t.active);
    pal.setColor(QPalette::ButtonText, t.t1);
    box.setPalette(pal);
    box.setAutoFillBackground(true);
    box.setAttribute(Qt::WA_StyledBackground, true);
    static QStyle* fusion = QStyleFactory::create("Fusion");
    if (fusion) box.setStyle(fusion);
    box.setStyleSheet(QString(
        "QMessageBox { background-color:%1; }"
        "QLabel { color:%2; background:transparent; }"
        "QPushButton { background-color:%3; color:%2; border:1px solid %4; border-radius:4px; padding:5px 16px; min-width:72px; }"
        "QPushButton:hover { background-color:%5; }"
        "QPushButton:default { border-color:%6; }")
                          .arg(hex(t.card), hex(t.t1), hex(t.bg1), hex(t.border2), hex(t.hover), hex(t.accent)));
    box.setText(text);
    if (def != QMessageBox::NoButton) box.setDefaultButton(def);
    for (QLabel* label : box.findChildren<QLabel*>()) {
        if (label->text().isEmpty()) continue;
        label->setWordWrap(true);
        QPalette lp = pal;
        lp.setColor(QPalette::WindowText, t.t1);
        lp.setColor(QPalette::Text, t.t1);
        label->setPalette(lp);
    }
    return static_cast<QMessageBox::StandardButton>(box.exec());
}
QHBoxLayout* hbox(QWidget* p, int sp, QMargins m) { auto* l = new QHBoxLayout(p); l->setSpacing(sp); l->setContentsMargins(m); return l; }
QVBoxLayout* vbox(QWidget* p, int sp, QMargins m) { auto* l = new QVBoxLayout(p); l->setSpacing(sp); l->setContentsMargins(m); return l; }
QFrame* hsep(const char* kind) {
    auto* f = new QFrame; f->setProperty("sep", kind); f->setFixedHeight(1); f->setFrameShape(QFrame::NoFrame); return f;
}
void drawPm(QPainter& p, const QPixmap& pm, const QRectF& box) {
    if (pm.isNull()) return;
    const qreal d = pm.devicePixelRatio();
    const QSizeF s(pm.width() / d, pm.height() / d);
    p.drawPixmap(QRectF(box.center().x() - s.width() / 2, box.center().y() - s.height() / 2, s.width(), s.height()), pm, pm.rect());
}
void drawGradText(QPainter& p, const QRectF& gradBox, const QRectF& tb, const QString& text, const QFont& f, Qt::Alignment al) {
    QFontMetricsF fm(f);
    const qreal w = fm.horizontalAdvance(text);
    qreal x = tb.left();
    if (al & Qt::AlignHCenter) x = tb.left() + (tb.width() - w) / 2;
    const qreal y = tb.top() + (tb.height() - fm.height()) / 2 + fm.ascent();
    QPainterPath path; path.addText(x, y, f, text);
    p.setRenderHint(QPainter::Antialiasing);
    p.fillPath(path, Theme::I().accentBrush(gradBox));
}
QMenu* makeMenu(QWidget* parent, int minW, bool sub) {
    auto* m = new QMenu(parent);
    m->setWindowFlags(m->windowFlags() | Qt::FramelessWindowHint | Qt::NoDropShadowWindowHint);
    m->setAttribute(Qt::WA_TranslucentBackground);
    m->setMinimumWidth(minW);
    m->setFont(Theme::uiFont(12));
    if (sub) m->setProperty("sub", "1");
    return m;
}

static const char* kQC[] = {"#7c6cff", "#00e676", "#f2cc8f", "#64b5f6", "#f48fb1", "#ce93d8", "#ffb74d", "#80deea"};
QColor queueColor(int n) { return QColor(kQC[(qMax(1, n) - 1) % 8]); }
static QVector<QPixmap> digitPms(int n, Use use) {
    QVector<QPixmap> v;
    for (const QChar c : QString::number(n))
        v << Theme::I().icon(c == '0' ? QString("num/zero.png") : QString("num/number-%1.png").arg(c), use, 14);
    return v;
}
QSize queueNumSize(int n) {
    int w = 0;
    for (const QPixmap& pm : digitPms(n, Use::Plain)) w += qRound(pm.width() / pm.devicePixelRatio());
    return {qMax(18, w + 6), 20};
}
void paintQueueNum(QPainter& p, const QPointF& c, int n, Use use) {
    const QVector<QPixmap> d = digitPms(n, use);
    int dw = 0; for (const QPixmap& pm : d) dw += qRound(pm.width() / pm.devicePixelRatio());
    const qreal w = qMax(18, dw + 6), h = 20;
    const QRectF r(c.x() - w / 2, c.y() - h / 2, w, h);
    const QColor g = queueColor(n);
    const Theme& th = Theme::I();
    p.save(); p.setRenderHint(QPainter::Antialiasing);
    QColor ring; bool glow = false;
    if (th.id() == "theme1") ring = QColor(110, 158, 212, int(255 * .45));
    else if (th.id() == "theme4") ring = QColor(225, 93, 93, int(255 * .45));
    else { ring = g; ring.setAlphaF(.35); glow = true; }
    if (glow) {
        for (int i = 8; i >= 1; --i) {                           // 0 0 8px: layered soft halo
            QColor gc = g; gc.setAlphaF(0.40 * 0.11 * (1.0 - (i - 1) / 8.0));
            QPainterPath ph; ph.addRoundedRect(r.adjusted(-i, -i, i, i), 7 + i, 7 + i);
            p.fillPath(ph, gc);
        }
    }
    QPainterPath outer; outer.addRoundedRect(r.adjusted(-1, -1, 1, 1), 8, 8);
    QPainterPath inner; inner.addRoundedRect(r, 7, 7);
    p.fillPath(outer.subtracted(inner), ring);
    QColor bg = g; bg.setAlphaF(.16);
    p.fillPath(inner, bg);
    qreal x = r.center().x() - dw / 2.0;
    for (const QPixmap& pm : d) {
        const qreal pw = pm.width() / pm.devicePixelRatio(), ph = pm.height() / pm.devicePixelRatio();
        p.drawPixmap(QRectF(x, r.center().y() - ph / 2, pw, ph), pm, pm.rect());
        x += pw;
    }
    p.restore();
}

QString fmtSize(double bytes, int dec) {
    if (!(bytes > 0)) return QString::fromUtf8("\xE2\x80\x94");
    static const char* u[] = {"B", "KB", "MB", "GB", "TB"};
    int i = qMin(4, int(std::floor(std::log(bytes) / std::log(1024.0))));
    if (i < 0) i = 0;
    const double n = bytes / std::pow(1024.0, i);
    return (i == 0 ? QString::number(qRound64(n)) : QString::number(n, 'f', dec)) + " " + u[i];
}
QString fmtTimeShort(double s) {
    if (!(s > 0) || std::isinf(s)) return QString::fromUtf8("\xE2\x80\x94");
    const int h = int(s / 3600), m = int(std::fmod(s, 3600) / 60), sec = int(std::fmod(s, 60));
    if (h > 0) return QString("%1h %2m").arg(h).arg(m);
    if (m > 0) return QString("%1m %2s").arg(m).arg(sec);
    return QString("%1s").arg(sec);
}
QString fmtDuration(double seconds) {
    const int s = qRound(seconds);
    if (s <= 0) return QString::fromUtf8("\xE2\x80\x94");
    if (s < 60) return QString("%1 sec").arg(s);
    const int m = s / 60, rem = s % 60;
    if (m < 60) return QString("%1 min %2 sec").arg(m).arg(rem);
    const int h = m / 60, mins = m % 60;
    return mins ? QString("%1 h %2 min").arg(h).arg(mins) : QString("%1 h").arg(h);
}

// =================================================================== PushButton
PushButton::PushButton(Kind k, const QString& text, QWidget* parent) : QPushButton(text, parent), m_k(k) {
    setAttribute(Qt::WA_Hover);
    setCursor(Qt::PointingHandCursor);
    setFocusPolicy(Qt::TabFocus);
    if (k == Win) { m_rad = 4; m_w = 400; m_padH = 8; m_padV = 4; }
    if (k == Install) { m_rad = 6; m_w = 600; m_padH = 14; m_padV = 0; }
    setFont(Theme::uiFont(12, m_w));
    connect(&Theme::I(), &Theme::changed, this, [this] { update(); });
}
PushButton& PushButton::metrics(int padH, int padV, int radius, int weight) {
    m_padH = padH; m_padV = padV; m_rad = radius; m_w = weight; setFont(Theme::uiFont(12, weight)); updateGeometry(); return *this;
}
PushButton& PushButton::fixed(int w, int h) { setFixedSize(w, h); return *this; }
QSize PushButton::sizeHint() const {
    const QFontMetrics fm(font());
    QSize s(fm.horizontalAdvance(text()) + 2 * m_padH, fm.lineSpacing() + 2 * m_padV);
    if (m_minW > 0) s.setWidth(qMax(s.width(), m_minW));
    return s;
}
void PushButton::paintEvent(QPaintEvent*) {
    const Theme& th = Theme::I(); const Tokens& t = th.t();
    QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
    const bool hov = underMouse() && isEnabled();
    const qreal op = isEnabled() ? 1.0 : 0.4;
    p.setOpacity(op);
    const QRectF r(rect());
    auto fillRR = [&](const QRectF& rr, qreal rad, const QBrush& b) { QPainterPath pp; pp.addRoundedRect(rr, rad, rad); p.fillPath(pp, b); };
    QColor fg = Qt::white;
    bool gradText = false;
    QRectF rr = r;
    if (m_k == Install && isDown()) rr.translate(0, 1);

    if ((m_k == Primary || m_k == Install) && th.is3()) {
        fillRR(rr, m_rad, th.accentBrush(rr));                                      // border-box gradient
        const QRectF in = rr.adjusted(1.5, 1.5, -1.5, -1.5);
        const qreal ir = qMax(0.0, m_rad - 1.5);
        if (m_k == Primary) {
            fillRR(in, ir, t.card);
            p.setOpacity(op * (hov ? .44 : .32));                                   // ::after overlay
            fillRR(in, ir, th.accentBrush(in));
            p.setOpacity(op);
            fg = QColor("#eff2f6");
        } else {
            fillRR(in, ir, hov ? t.hover : t.bg1);
            gradText = true;
        }
    } else if (m_k == Primary || m_k == Install) {
        fillRR(rr, m_rad, hov ? Theme::mul(t.accent, m_k == Primary ? 1.08 : 1.10) : t.accent);
    } else if (m_k == Secondary) {
        QColor bg = hov ? t.hover : t.active;
        fg = hov ? t.t1 : t.t2;
        if (th.id() == "theme1") { fg = Qt::white; if (hov) bg = Theme::mul(bg, 1.1); }
        fillRR(rr, m_rad, bg);
    } else {                                                                         // Win
        const QColor bd = m_accBorder ? t.accentDim : t.border2;
        fillRR(rr, m_rad, bd);
        fillRR(rr.adjusted(1, 1, -1, -1), qMax(0.0, m_rad - 1.0), hov ? t.hover : t.bg3);
        fg = t.t1;
    }
    p.setFont(font());
    if (gradText) {
        const QFontMetricsF fm(font());
        const qreal w = fm.horizontalAdvance(text());
        const QRectF tb(rr.center().x() - w / 2, rr.top(), w, rr.height());
        drawGradText(p, tb, rr, text(), font(), Qt::AlignHCenter);
    } else {
        p.setPen(fg);
        p.drawText(rr, Qt::AlignCenter, text());
    }
}

// =================================================================== check / radio / toggle
static void paintGlyph(QPainter& p, const QRectF& b, bool radio, bool on, bool hov, bool en) {
    p.save(); p.setRenderHint(QPainter::Antialiasing);
    p.setOpacity(en ? 1.0 : 0.5);
    const QColor acc = radio ? Theme::I().t().accent : QColor("#0075ff");   // radios carry accent-color, checkboxes use Chromium blue
    const QColor bd = on ? (radio ? Theme::I().t().accent : acc) : (hov ? QColor("#4f4f4f") : QColor("#767676"));
    p.setPen(QPen(bd, 1));
    if (!radio) {
        p.setBrush(on ? acc : QColor(Qt::white));
        p.drawRoundedRect(b.adjusted(.5, .5, -.5, -.5), 2, 2);
        if (on) {
            p.setPen(QPen(Qt::white, 1.7, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));
            p.drawPolyline(QPolygonF({{b.left() + 3.2, b.top() + 6.8}, {b.left() + 5.6, b.top() + 9.2}, {b.left() + 10, b.top() + 4.2}}));
        }
    } else {
        p.setBrush(Qt::white);
        p.drawEllipse(b.adjusted(.5, .5, -.5, -.5));
        if (on) { p.setPen(Qt::NoPen); p.setBrush(Theme::I().t().accent); p.drawEllipse(b.center(), 3.4, 3.4); }
    }
    p.restore();
}
ChkBox::ChkBox(const QString& t, QWidget* p) : QCheckBox(t, p) {
    setFont(Theme::uiFont(12)); setAttribute(Qt::WA_Hover); setCursor(Qt::ArrowCursor); setFocusPolicy(Qt::TabFocus);
}
QSize ChkBox::sizeHint() const {
    const int tw = text().isEmpty() ? 0 : 6 + QFontMetrics(font()).horizontalAdvance(text());
    return {4 + 13 + 3 + tw, 19};
}
void ChkBox::paintEvent(QPaintEvent*) {
    QPainter p(this);
    paintGlyph(p, QRectF(4, (height() - 13) / 2.0, 13, 13), false, isChecked(), underMouse(), isEnabled());
    if (!text().isEmpty()) {
        p.setPen(isEnabled() ? Theme::I().t().t1 : Theme::I().t().muted); p.setFont(font());
        p.drawText(QRect(26, 0, width() - 26, height()), Qt::AlignVCenter | Qt::AlignLeft, text());
    }
}
RadBox::RadBox(const QString& t, QWidget* p) : QRadioButton(t, p) { setFont(Theme::uiFont(12)); setAttribute(Qt::WA_Hover); setFocusPolicy(Qt::TabFocus); }
QSize RadBox::sizeHint() const {
    const int tw = text().isEmpty() ? 0 : 6 + QFontMetrics(font()).horizontalAdvance(text());
    return {5 + 13 + 3 + tw, 18};
}
void RadBox::paintEvent(QPaintEvent*) {
    QPainter p(this);
    paintGlyph(p, QRectF(5, 2, 13, 13), true, isChecked(), underMouse(), isEnabled());
    if (!text().isEmpty()) {
        p.setPen(Theme::I().t().t1); p.setFont(font());
        p.drawText(QRect(27, 0, width() - 27, height()), Qt::AlignVCenter | Qt::AlignLeft, text());
    }
}

Toggle::Toggle(QWidget* p) : QAbstractButton(p) {
    setCheckable(true); setCursor(Qt::PointingHandCursor); setFixedSize(38, 20); setFocusPolicy(Qt::TabFocus);
    m_anim = new QPropertyAnimation(this, "knob", this);
    m_anim->setDuration(150); m_anim->setEasingCurve(QEasingCurve::InOutQuad);
    connect(this, &QAbstractButton::toggled, this, [this](bool on) { m_anim->stop(); m_anim->setStartValue(m_pos); m_anim->setEndValue(on ? 1.0 : 0.0); m_anim->start(); });
    connect(&Theme::I(), &Theme::changed, this, [this] { update(); });
}
void Toggle::paintEvent(QPaintEvent*) {
    const Theme& th = Theme::I();
    QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
    const QRectF r(0, 0, 38, 20);
    QPainterPath path; path.addRoundedRect(r, 10, 10);
    if (isChecked() || m_pos > 0.5) {
        if (th.is3()) p.fillPath(path, Theme::cssGradient(r, 90, {{0, QColor("#00d2ff")}, {.25, QColor("#38bdf8")}, {.65, QColor("#b85dff")}, {1, QColor("#ff00fc")}}));
        else p.fillPath(path, th.t().accent);
    } else p.fillPath(path, th.id() == "theme2" ? QColor("#8b93a7") : QColor("#3a3a55"));
    const QPointF c(3 + 7 + 18 * m_pos, 10);
    if (th.is3() && isChecked()) { p.setPen(Qt::NoPen); p.setBrush(QColor(0, 0, 0, 40)); p.drawEllipse(c + QPointF(0, 1), 8, 8); }
    p.setPen(Qt::NoPen); p.setBrush(Qt::white); p.drawEllipse(c, 7, 7);
}
ToggleRow::ToggleRow(const QString& text, int px, int vpad, QWidget* parent) : QWidget(parent) {
    auto* h = hbox(this, 16, QMargins(0, vpad, 0, vpad));
    auto* l = makeLabel(text, px, 400, "t1"); l->setWordWrap(true);
    h->addWidget(l, 1);
    m_t = new Toggle; h->addWidget(m_t, 0, Qt::AlignVCenter);
    setCursor(Qt::PointingHandCursor);
    l->setAttribute(Qt::WA_TransparentForMouseEvents);
}

GradLabel::GradLabel(const QString& text, int px, int weight, QWidget* p) : QWidget(p), m_text(text), m_f(Theme::uiFont(px, weight)) {
    setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
    connect(&Theme::I(), &Theme::changed, this, [this] { update(); });
}
QSize GradLabel::sizeHint() const { QFontMetrics fm(m_f); return {fm.horizontalAdvance(m_text), fm.lineSpacing()}; }
void GradLabel::paintEvent(QPaintEvent*) {
    QPainter p(this);
    drawGradText(p, QRectF(rect()), QRectF(rect()), m_text, m_f, Qt::AlignLeft);
}

MenuRow::MenuRow(const QString& l, const QString& h, QWidget* p) : QWidget(p), m_l(l), m_h(h) {
    setAttribute(Qt::WA_Hover); setCursor(Qt::ArrowCursor);
}
QSize MenuRow::sizeHint() const {
    const QFontMetrics a(Theme::uiFont(12, 600)), b(Theme::uiFont(11));
    return {218, 8 + a.lineSpacing() + 2 + b.lineSpacing() + 8};
}
void MenuRow::paintEvent(QPaintEvent*) {
    const Tokens& t = Theme::I().t();
    QPainter p(this);
    if (underMouse()) p.fillRect(rect(), t.hover);
    const QFont f1 = Theme::uiFont(12, 600), f2 = Theme::uiFont(11);
    p.setFont(f1); p.setPen(t.t1);
    const QFontMetrics a(f1), b(f2);
    p.drawText(QRect(14, 8, width() - 28, a.lineSpacing()), Qt::AlignVCenter, m_l);
    p.setFont(f2); p.setPen(underMouse() ? t.t1 : t.t2);
    p.drawText(QRect(14, 8 + a.lineSpacing() + 2, width() - 28, b.lineSpacing()), Qt::AlignVCenter, m_h);
}

// =================================================================== frameless window
class TitleBar : public QWidget {
public:
    TitleBar(FramelessWindow* w) : QWidget(w), m_w(w) { setMouseTracking(true); }
    TitleSpec s;
    void setSpec(const TitleSpec& n) { s = n; setFixedHeight(n.h); setVisible(n.h > 0); update(); }
protected:
    int btnAt(const QPoint& pt) const {
        int x = width();
        const int order[3] = {1, 4, 2};
        for (int k : order) {
            if (!(s.buttons & k)) continue;
            x -= 46;
            if (pt.x() >= x && pt.x() < x + 46 && pt.y() >= 0 && pt.y() < height()) return k;
        }
        return 0;
    }
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t();
        QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        if (!s.barClear) {
            p.fillRect(rect(), s.winBg == TitleSpec::Card ? t.card : t.bg2);
            if (s.border) p.fillRect(QRect(0, height() - 1, width(), 1), t.border);
        }
        if (s.app) {
            const QPixmap pm(Theme::assetPath("icons/app.png"));
            if (!pm.isNull()) p.drawPixmap(QRect(12, (height() - 16) / 2, 16, 16), pm.scaled(32, 32, Qt::KeepAspectRatio, Qt::SmoothTransformation));
            p.setFont(Theme::uiFont(12)); p.setPen(t.t2);
            p.drawText(QRect(12 + 16 + 8, 0, width() - 200, height()), Qt::AlignVCenter, s.caption);
        } else if (!s.caption.isEmpty()) {
            p.setFont(Theme::uiFont(12, s.capWeight)); p.setPen(t.t1);
            p.drawText(QRect(s.capPad, 0, width() - 46 - s.capPad, height()), Qt::AlignVCenter, s.caption);
        }
        int x = width();
        const int order[3] = {1, 4, 2};
        for (int k : order) {
            if (!(s.buttons & k)) continue;
            x -= 46;
            const QRectF b(x, 0, 46, height());
            const bool hv = (m_hover == k);
            if (hv) p.fillRect(b, k == 1 ? QColor("#e81123") : t.hover);
            p.setPen(QPen(hv && k == 1 ? QColor(Qt::white) : t.t2, 1));
            const QPointF c = b.center();
            if (k == 1) { p.drawLine(c + QPointF(-5, -5), c + QPointF(5, 5)); p.drawLine(c + QPointF(-5, 5), c + QPointF(5, -5)); }
            else if (k == 2) p.drawLine(c + QPointF(-5, 0.5), c + QPointF(5, 0.5));
            else if (m_w->isMaximized()) { p.drawRect(QRectF(c.x() - 4, c.y() - 2, 7, 7)); p.drawPolyline(QPolygonF({{c.x() - 2, c.y() - 2}, {c.x() - 2, c.y() - 4.5}, {c.x() + 4.5, c.y() - 4.5}, {c.x() + 4.5, c.y() + 2}, {c.x() + 3, c.y() + 2}})); }
            else p.drawRect(QRectF(c.x() - 5, c.y() - 5, 10, 10));
        }
    }
    void mouseMoveEvent(QMouseEvent* e) override { const int h = btnAt(e->pos()); if (h != m_hover) { m_hover = h; update(); } }
    void leaveEvent(QEvent*) override { m_hover = 0; update(); }
    void mousePressEvent(QMouseEvent* e) override {
        if (e->button() != Qt::LeftButton) return;
        const int b = btnAt(e->pos());
        if (b) { m_press = b; return; }
        if (m_w->windowHandle()) m_w->windowHandle()->startSystemMove();
    }
    void mouseReleaseEvent(QMouseEvent* e) override {
        const int b = btnAt(e->pos());
        if (b && b == m_press) {
            if (b == 1) m_w->close();
            else if (b == 2) m_w->showMinimized();
            else m_w->isMaximized() ? m_w->showNormal() : m_w->showMaximized();
        }
        m_press = 0;
    }
    void mouseDoubleClickEvent(QMouseEvent* e) override {
        if ((s.buttons & 4) && !btnAt(e->pos())) m_w->isMaximized() ? m_w->showNormal() : m_w->showMaximized();
    }
private:
    FramelessWindow* m_w; int m_hover = 0, m_press = 0;
};

FramelessWindow::FramelessWindow(const TitleSpec& s, bool resizable, bool edge, QWidget* parent)
    : QWidget(parent, Qt::Window), m_s(s), m_resizable(resizable), m_edge(edge) {
    setAttribute(Qt::WA_DeleteOnClose, false);
    auto* v = vbox(this);
    v->setContentsMargins(1, 1, 1, 1);
    m_bar = new TitleBar(this); v->addWidget(m_bar);
    m_body = new QWidget; v->addWidget(m_body, 1);
    m_bar->setSpec(s);
    connect(&Theme::I(), &Theme::changed, this, [this] { polishChrome(); update(); });
}
void FramelessWindow::polishChrome() {
#ifdef Q_OS_WIN
    const HWND hwnd = reinterpret_cast<HWND>(winId());
    LONG style = GetWindowLong(hwnd, GWL_STYLE);
    style |= WS_THICKFRAME | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
    SetWindowLong(hwnd, GWL_STYLE, style);
    const int corner = DWMWCP_ROUND;
    DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &corner, sizeof(corner));
    const QColor c = Theme::I().t().border;
    const COLORREF ref = RGB(c.red(), c.green(), c.blue());
    DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, &ref, sizeof(ref));
    const BOOL dark = Theme::I().id() != "theme2";
    DwmSetWindowAttribute(hwnd, 20, &dark, sizeof(dark));
    SetWindowPos(hwnd, nullptr, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
#else
    Q_UNUSED(this)
#endif
}
void FramelessWindow::showEvent(QShowEvent* e) {
    polishChrome();
    QWidget::showEvent(e);
}
void FramelessWindow::changeEvent(QEvent* e) {
    if (e->type() == QEvent::WindowStateChange) {
        const int m = isMaximized() ? 0 : 1;
        if (QLayout* lay = layout()) lay->setContentsMargins(m, m, m, m);
        polishChrome();
    }
    QWidget::changeEvent(e);
}
void FramelessWindow::setTitle(const TitleSpec& s) { m_s = s; m_bar->setSpec(s); setWindowTitle(s.caption); update(); }
void FramelessWindow::setCaption(const QString& c) { m_s.caption = c; m_bar->setSpec(m_s); setWindowTitle(c); }
void FramelessWindow::paintEvent(QPaintEvent*) {
    const Tokens& t = Theme::I().t();
    QPainter p(this);
    p.fillRect(rect(), m_s.winBg == TitleSpec::Card ? t.card : (m_s.winBg == TitleSpec::Prim ? t.bg1 : t.bg2));
    if (!isMaximized()) {
        p.setPen(QPen(m_edge ? t.edge : t.border, 1));
        p.drawRect(rect().adjusted(0, 0, -1, -1));
    }
}
bool FramelessWindow::nativeEvent(const QByteArray& type, void* msg, qintptr* result) {
#ifdef Q_OS_WIN
    if (type == "windows_generic_MSG") {
        MSG* m = static_cast<MSG*>(msg);
        if (m->message == WM_NCCALCSIZE && m->wParam) {
            if (IsZoomed(m->hwnd)) {
                auto* p = reinterpret_cast<NCCALCSIZE_PARAMS*>(m->lParam);
                MONITORINFO mi{sizeof(mi)};
                if (GetMonitorInfo(MonitorFromWindow(m->hwnd, MONITOR_DEFAULTTONEAREST), &mi)) p->rgrc[0] = mi.rcWork;
            }
            *result = 0;
            return true;
        }
        if (m_resizable && m->message == WM_NCHITTEST && !isMaximized()) {
            const LONG b = LONG(6 * devicePixelRatioF());
            RECT r; GetWindowRect(m->hwnd, &r);
            const LONG x = GET_X_LPARAM(m->lParam), y = GET_Y_LPARAM(m->lParam);
            const bool L = x < r.left + b, R = x >= r.right - b, T = y < r.top + b, B = y >= r.bottom - b;
            if (T && L) { *result = HTTOPLEFT; return true; }
            if (T && R) { *result = HTTOPRIGHT; return true; }
            if (B && L) { *result = HTBOTTOMLEFT; return true; }
            if (B && R) { *result = HTBOTTOMRIGHT; return true; }
            if (L) { *result = HTLEFT; return true; }
            if (R) { *result = HTRIGHT; return true; }
            if (T) { *result = HTTOP; return true; }
            if (B) { *result = HTBOTTOM; return true; }
        }
    }
#else
    Q_UNUSED(type) Q_UNUSED(msg) Q_UNUSED(result)
#endif
    return QWidget::nativeEvent(type, msg, result);
}
