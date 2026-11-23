#pragma once
#include "Theme.h"
#include <QtWidgets>

// ------------------------------------------------------------ small helpers
QLabel* makeLabel(const QString& text, int px, int weight = 400, const char* tok = "t1", QWidget* parent = nullptr);
QHBoxLayout* hbox(QWidget* parent = nullptr, int spacing = 0, QMargins m = QMargins());
QVBoxLayout* vbox(QWidget* parent = nullptr, int spacing = 0, QMargins m = QMargins());
QFrame* hsep(const char* kind = "1");                       // 1px line, kind "1" = --border, "2" = --border-light
void drawPm(QPainter& p, const QPixmap& pm, const QRectF& box);    // centred, object-fit: contain
void drawGradText(QPainter& p, const QRectF& gradBox, const QRectF& textBox, const QString& text, const QFont& f, Qt::Alignment al);
QMenu* makeMenu(QWidget* parent, int minW = 180, bool sub = false);
QColor queueColor(int n);
void paintQueueNum(QPainter& p, const QPointF& center, int n, Use use);     // .q-num
QSize queueNumSize(int n);
QString fmtSize(double bytes, int dec = 2);                  // "1.5 MB"
QString fmtTimeShort(double seconds);                        // "1h 2m", "3m 4s", "5s"
QString fmtDuration(double seconds);                         // "3 min 4 sec"
// Windows draws QMessageBox on a white panel while the app palette text is near-white.
QMessageBox::StandardButton askBox(QWidget* parent, QMessageBox::Icon icon, const QString& title, const QString& text,
                                    QMessageBox::StandardButtons buttons = QMessageBox::Ok,
                                    QMessageBox::StandardButton def = QMessageBox::NoButton);

// ------------------------------------------------------------ buttons
class PushButton : public QPushButton {
    Q_OBJECT
public:
    enum Kind { Primary, Secondary, Win, Install };
    PushButton(Kind k, const QString& text, QWidget* parent = nullptr);
    PushButton& metrics(int padH, int padV, int radius, int weight);
    PushButton& fixed(int w, int h);
    PushButton& minW(int w) { m_minW = w; updateGeometry(); return *this; }
    PushButton& accentBorder(bool on) { m_accBorder = on; return *this; }
    QSize sizeHint() const override;
protected:
    void paintEvent(QPaintEvent*) override;
private:
    Kind m_k; int m_padH = 18, m_padV = 7, m_rad = 4, m_w = 500, m_minW = -1; bool m_accBorder = false;
};

class ChkBox : public QCheckBox {            // Chromium default checkbox (13x13, margin 3px 3px 3px 4px)
    Q_OBJECT
public:
    explicit ChkBox(const QString& text = QString(), QWidget* parent = nullptr);
    QSize sizeHint() const override;
    bool hitButton(const QPoint&) const override { return true; }
protected:
    void paintEvent(QPaintEvent*) override;
};
class RadBox : public QRadioButton {         // radio, accent-color: var(--accent)
    Q_OBJECT
public:
    explicit RadBox(const QString& text = QString(), QWidget* parent = nullptr);
    QSize sizeHint() const override;
    bool hitButton(const QPoint&) const override { return true; }
protected:
    void paintEvent(QPaintEvent*) override;
};

class Toggle : public QAbstractButton {      // .toggle-ui 38x20
    Q_OBJECT
    Q_PROPERTY(qreal knob READ knob WRITE setKnob)
public:
    explicit Toggle(QWidget* parent = nullptr);
    QSize sizeHint() const override { return {38, 20}; }
    qreal knob() const { return m_pos; }
    void setKnob(qreal v) { m_pos = v; update(); }
    void setCheckedNoAnim(bool on) { setChecked(on); m_pos = on ? 1 : 0; update(); }
protected:
    void paintEvent(QPaintEvent*) override;
private:
    qreal m_pos = 0; QPropertyAnimation* m_anim;
};
class ToggleRow : public QWidget {           // label + toggle, whole row clickable
    Q_OBJECT
public:
    ToggleRow(const QString& text, int px, int vpad, QWidget* parent = nullptr);
    Toggle* toggle() const { return m_t; }
protected:
    void mouseReleaseEvent(QMouseEvent* e) override { if (e->button() == Qt::LeftButton) m_t->click(); }
private:
    Toggle* m_t;
};

class GradLabel : public QWidget {           // text with background-clip:text and var(--accent-gradient)
public:
    GradLabel(const QString& text, int px, int weight, QWidget* parent = nullptr);
    QSize sizeHint() const override;
protected:
    void paintEvent(QPaintEvent*) override;
private:
    QString m_text; QFont m_f;
};

class MenuRow : public QWidget {             // two-line item of #delete-menu
    Q_OBJECT
public:
    MenuRow(const QString& label, const QString& hint, QWidget* parent = nullptr);
    QSize sizeHint() const override;
signals:
    void clicked();
protected:
    void paintEvent(QPaintEvent*) override;
    void mouseReleaseEvent(QMouseEvent*) override { emit clicked(); }
private:
    QString m_l, m_h;
};

// ------------------------------------------------------------ frameless window with the Windows caption overlay
struct TitleSpec {
    enum Bg { Sec, Card, Prim };
    int h = 32;                    // 0 = none
    QString caption;
    bool app = false;              // .app-titlebar (icon + name, no bold caption)
    bool border = true;            // border-bottom: 1px solid var(--border)
    bool barClear = false;         // transparent drag bar (data-frameless)
    int buttons = 1;               // 1 close, 2 min, 4 max (OR-ed)
    int capWeight = 650, capPad = 12;
    Bg winBg = Sec;
};
class TitleBar;
class FramelessWindow : public QWidget {
    Q_OBJECT
public:
    explicit FramelessWindow(const TitleSpec& s, bool resizable = false, bool edge = false, QWidget* parent = nullptr);
    QWidget* body() const { return m_body; }
    void setTitle(const TitleSpec& s);
    void setCaption(const QString& c);
    const TitleSpec& spec() const { return m_s; }
protected:
    void paintEvent(QPaintEvent*) override;
    void showEvent(QShowEvent*) override;
    void changeEvent(QEvent*) override;
    bool nativeEvent(const QByteArray& type, void* msg, qintptr* result) override;
private:
    void polishChrome();
    TitleSpec m_s; TitleBar* m_bar; QWidget* m_body; bool m_resizable, m_edge;
};
