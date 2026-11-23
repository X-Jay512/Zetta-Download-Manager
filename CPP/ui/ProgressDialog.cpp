#include "Dialogs.h"
#include <cmath>

// ------------------------------------------------------------------ local widgets
static QString progTime(double s) {
    if (!(s >= 0) || std::isinf(s)) return QString::fromUtf8("\xE2\x80\x94");
    const int r = qRound(s);
    if (r < 60) return QString("%1 sec").arg(r);
    const int m = r / 60, rem = r % 60;
    if (m < 60) return QString("%1 min %2 sec").arg(m).arg(rem);
    return QString("%1 h %2 min").arg(m / 60).arg(m % 60);
}
static QString bytesPair(double b) {
    const double n = qMax(0.0, std::round(b));
    return n >= 1024 * 1024 ? fmtSize(n, 3) : QLocale().toString(qint64(n)) + " Bytes";
}

class TabBtn : public QAbstractButton {
public:
    TabBtn(const QString& t, QWidget* p) : QAbstractButton(p) { setText(t); setCheckable(true); setAttribute(Qt::WA_Hover); setCursor(Qt::PointingHandCursor); setFocusPolicy(Qt::NoFocus); }
    QSize sizeHint() const override { const QFontMetrics fm(Theme::uiFont(12, isChecked() ? 600 : 400)); return {fm.horizontalAdvance(text()) + 20, fm.lineSpacing() + 8}; }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        QPainterPath pp; pp.addRoundedRect(QRectF(rect()), 4, 4);
        if (isChecked()) p.fillPath(pp, t.active); else if (underMouse()) p.fillPath(pp, t.hover);
        p.setFont(Theme::uiFont(12, isChecked() ? 600 : 400)); p.setPen(isChecked() || underMouse() ? t.t1 : t.t2);
        p.drawText(rect(), Qt::AlignCenter, text());
    }
};
class Panel : public QWidget {                    // .panel: border-top/bottom 1px, padding 10px 2px, height 170
public:
    Panel(QWidget* p) : QWidget(p) { setFixedHeight(170); }
protected:
    void paintEvent(QPaintEvent*) override { QPainter p(this); const Tokens& t = Theme::I().t(); p.fillRect(QRect(0, 0, width(), 1), t.border); p.fillRect(QRect(0, height() - 1, width(), 1), t.border); }
};
class Meter : public QWidget {                    // .bar (18px, radius 6). Coasts 120ms, then snaps.
public:
    Meter(QWidget* p) : QWidget(p) {
        setFixedHeight(18);
        m_t.setInterval(16); connect(&m_t, &QTimer::timeout, this, [this] { step(); });
    }
    bool paused = false;
    void setTarget(double pct, double speed, double span, bool moving) {
        m_pct = pct; m_speed = speed; m_span = span; m_at.restart();
        if (pct > m_shown || !moving) m_shown = pct;
        if (moving && span > 0 && speed >= 100) { if (!m_t.isActive()) m_t.start(); }
        else { m_t.stop(); m_shown = pct; }
        update();
    }
protected:
    void step() {
        double target = m_pct;
        if (m_span > 0 && m_speed >= 100)
            target = qMin(99.9, m_pct + (m_speed * qMin(0.12, m_at.elapsed() / 1000.0) / m_span) * 100.0);
        if (target > m_shown) m_shown = target;
        update();
    }
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        const QRectF r(rect());
        QPainterPath o; o.addRoundedRect(r, 6, 6); p.fillPath(o, t.border);
        QPainterPath in; in.addRoundedRect(r.adjusted(1, 1, -1, -1), 5, 5);
        p.fillPath(in, t.active);
        p.save(); p.setClipPath(in);
        p.fillRect(QRectF(1, 1, (width() - 2) * qBound(0.0, m_shown, 100.0) / 100.0, height() - 2), paused ? t.warn : t.ok);
        p.restore();
    }
private:
    QTimer m_t; QElapsedTimer m_at; double m_pct = 0, m_shown = 0, m_speed = 0, m_span = 0;
};
class SegBar : public QWidget {                   // .segbar
public:
    struct Seg { double flex; double pct; bool live; };
    SegBar(QWidget* p) : QWidget(p) { setFixedHeight(14); }
    void setSegs(const QVector<Seg>& s) { m_s = s; update(); }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        const QRectF r(rect()); QPainterPath o; o.addRoundedRect(r, 6, 6); p.fillPath(o, t.border);
        QPainterPath in; in.addRoundedRect(r.adjusted(1, 1, -1, -1), 5, 5); p.fillPath(in, t.active);
        p.save(); p.setClipPath(in);
        double sum = 0; for (const Seg& s : m_s) if (s.live) sum += s.flex;
        double x = 1; const double W = width() - 2; bool first = true;
        for (const Seg& s : m_s) {
            if (!s.live) continue;
            const double w = sum > 0 ? W * s.flex / sum : 0;
            if (!first) p.fillRect(QRectF(x, 1, 1, height() - 2), t.bg2);         // inset 1px 0 0 var(--bg-secondary)
            p.fillRect(QRectF(x, 1, w * qBound(0.0, s.pct, 100.0) / 100.0, height() - 2), t.accent);
            x += w; first = false;
        }
        p.restore();
    }
private:
    QVector<Seg> m_s;
};
class ConnTable : public QAbstractScrollArea {    // table (th/td 22px, padding 0 4px) inside .table-wrap (132px)
public:
    ConnTable(QWidget* p) : QAbstractScrollArea(p) {
        setFixedHeight(132); setFrameShape(QFrame::NoFrame); setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff); verticalScrollBar()->setSingleStep(22);
        const QFontMetrics mb(Theme::uiFont(12, 600));
        m_min[0] = mb.horizontalAdvance("N.") + 16;
        m_min[1] = mb.horizontalAdvance("000.000 MB") + 16;
        m_min[2] = mb.horizontalAdvance("Downloading") + 16;
    }
    void setRows(const QVector<QStringList>& r) {
        if (r == m_r) return;
        m_r = r;
        verticalScrollBar()->setRange(0, qMax(0, (m_r.size() + 1) * 22 - viewport()->height()));
        viewport()->update();
    }
protected:
    void resizeEvent(QResizeEvent*) override { verticalScrollBar()->setRange(0, qMax(0, (m_r.size() + 1) * 22 - viewport()->height())); }
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(viewport());
        const QFont fb = Theme::uiFont(12, 600), fn = Theme::uiFont(12);
        const char* hd[3] = {"N.", "Downloaded", "Info"};
        const double sum = m_min[0] + m_min[1] + m_min[2], W = viewport()->width(), extra = sum > 0 ? qMax(0.0, W - sum) : 0;
        double w[3]; for (int c = 0; c < 3; ++c) w[c] = sum > 0 ? m_min[c] + extra * m_min[c] / sum : W / 3.0;
        const int off = verticalScrollBar()->value();
        auto rowAt = [&](int y, const QStringList& cells, bool header) {
            double x = 0;
            for (int c = 0; c < 3; ++c) {
                p.setFont(header ? fb : fn); p.setPen(t.t1);
                p.drawText(QRectF(x + 4, y, w[c] - 8, 22), Qt::AlignVCenter | Qt::AlignLeft, cells.value(c));
                x += w[c];
            }
            if (header) p.fillRect(QRect(0, y + 21, int(W), 1), t.border);
        };
        rowAt(-off, {hd[0], hd[1], hd[2]}, true);
        for (int i = 0; i < m_r.size(); ++i) rowAt((i + 1) * 22 - off, m_r[i], false);
    }
private:
    QVector<QStringList> m_r;
    int m_min[3] = {40, 80, 60};
};

// ------------------------------------------------------------------ ProgressDialog
struct ProgressDialog::Impl {
    Store* s; Bridge* b; QString id; QJsonObject rec; QString filePath;
    bool finished = false, detailsOpen = true, cancelAsk = true, userHold = false; QString cancelAction = "keep"; int defaultThreads = 8, rowCap = 0;
    QElapsedTimer rowsAt;
    QVector<QStringList> held;
    FramelessWindow* w;
    QLabel *fileName, *state, *sizeLbl, *fileSize, *recvLbl, *received, *speed, *left, *resume, *limitSpeed, *threadNote, *caption;
    QWidget *panels[3], *details, *sheet; TabBtn* tabs[3]; Meter* meter; SegBar* seg; ConnTable* table;
    PushButton *mainBtn, *cancelBtn; QAbstractButton* hideBtn; CopyBtn* copy;
    QSpinBox *threads, *limitKbps; ChkBox *useLimit, *showDialog, *optPower; QComboBox* powerAction; QWidget* askOverlay; ChkBox* askRemember;

    QString statusText() const {
        const QString st = rec.value("status").toString();
        if (rec.isEmpty()) return "Downloading";
        if (st == "paused") return "Pause"; if (st == "complete") return "Complete";
        if (st == "error") { const QString t = rec.value("errorTitle").toString(), e = rec.value("error").toString(); if (!t.isEmpty() && !e.isEmpty()) return t + ". " + e; return !t.isEmpty() ? t : (!e.isEmpty() ? e : "Failed"); }
        if (st == "queued") return "Waiting"; if (st == "merging" || st == "muxing") return "Assembling";
        return "Downloading";
    }
    static bool partLive(const QJsonObject& g) {
        if (g.value("downloaded").toDouble() > 0) return true;
        const QString s = g.value("status").toString();
        return s == "connecting" || s == "downloading" || s == "complete" || s == "paused" || s == "error" || s == "merging" || s == "muxing";
    }
    QString infoText(const QJsonObject& g) const {
        const QString s = g.value("status").toString();
        if (s == "error") return "Disconnect."; if (s == "complete") return "Complete";
        if (s == "paused" || (rec.value("status").toString() == "paused" && s != "complete")) return "Pause";
        if (s == "merging" || s == "muxing") return "Assembling"; if (s == "downloading") return "Downloading"; if (s == "connecting") return "Connecting";
        return QString();
    }
    QJsonArray foldToCap(const QJsonArray& list) const {
        const int cap = rowCap;
        if (!cap || list.isEmpty() || list.size() <= cap) return list;
        struct Lane { double dl = 0; QString st = "waiting"; bool busy = false; } lanes[64];
        auto rank = [](const QString& s) { return s == "downloading" ? 3 : s == "connecting" ? 2 : s == "paused" ? 1 : 0; };
        for (const auto& v : list) {
            const QJsonObject g = v.toObject(); Lane& l = lanes[g.value("index").toInt() % cap];
            l.dl += qMax(0.0, g.value("downloaded").toDouble());
            if (rank(g.value("status").toString()) > rank(l.st)) { l.st = g.value("status").toString(); l.busy = true; }
        }
        bool busy = false; for (int i = 0; i < cap; ++i) busy |= lanes[i].busy;
        const double total = rec.value("fileSize").toDouble(), goal = total > 0 ? std::ceil(total / cap) : 0;
        QJsonArray out;
        for (int i = 0; i < cap; ++i) out.append(QJsonObject{{"index", i}, {"start", 0}, {"end", goal > 0 ? goal - 1 : -1}, {"downloaded", lanes[i].dl},
            {"percent", goal > 0 ? qMin(100.0, lanes[i].dl / goal * 100) : 0.0},
            {"status", lanes[i].busy ? lanes[i].st : (lanes[i].dl > 0 ? (busy ? "downloading" : "complete") : "waiting")}});
        return out;
    }
    void renderConnections(const QJsonObject& pr) {
        const QString rs = rec.value("status").toString(), ps = pr.value("status").toString();
        const bool merging = rs == "merging" || rs == "muxing" || pr.value("phase").toString() == "merging" || ps == "merging" || ps == "muxing";
        if (merging) {
            held.clear();
            const double whole = pr.value("total").toDouble() > 0 ? pr.value("total").toDouble() : rec.value("fileSize").toDouble();
            const double written = qMax(0.0, pr.value("downloaded").toDouble());
            const double pct = pr.contains("percent") ? pr.value("percent").toDouble() : (whole > 0 ? qMin(100.0, written / whole * 100) : 0);
            seg->setSegs({{1, pct, true}});
            table->setRows({{"1", written > 0 ? bytesPair(written) : (whole > 0 ? "0 B" : ""), "Assembling"}});
            if (details->isVisible() != detailsOpen) details->setVisible(detailsOpen); return;
        }
        const QJsonArray incoming = foldToCap(pr.value("segments").toArray());
        bool meaningful = false;
        for (const auto& v : incoming) { const QJsonObject g = v.toObject(); const QString s = g.value("status").toString();
            if (g.value("downloaded").toDouble() > 0 || s == "downloading" || s == "connecting" || s == "complete" || s == "paused" || s == "merging") meaningful = true; }
        static QJsonArray heldSegs; if (meaningful || (heldSegs.isEmpty() && !incoming.isEmpty())) heldSegs = incoming;
        const QJsonArray list = meaningful ? incoming : (!heldSegs.isEmpty() ? heldSegs : incoming);
        QVector<SegBar::Seg> segs; QVector<QStringList> rows; int n = 0;
        for (const auto& v : list) {
            const QJsonObject g = v.toObject(); ++n;
            const double endv = g.value("end").toDouble(-1), startv = g.value("start").toDouble();
            const double span = endv >= 0 ? qMax(0.0, endv - startv + 1) : 0;
            const double shown = qMax(0.0, g.value("downloaded").toDouble());
            const double got = span > 0 ? qMin(span, shown) : shown;
            double sp = g.contains("percent") ? qBound(0.0, g.value("percent").toDouble(), 100.0) : (span > 0 ? qBound(0.0, got / span * 100, 100.0) : 0);
            if (g.value("status").toString() == "complete") sp = 100;
            const bool live = partLive(g); const QString st = g.value("status").toString();
            segs.append({span > 0 ? qMax(1.0, std::round(span)) : 1.0, sp, live});
            const QString info = !live ? QString() : (shown <= 0 && (st == "connecting" || st == "downloading") ? QString("Connecting") : infoText(g));
            rows.append({QString::number(n), live && shown > 0 ? bytesPair(shown) : QString(), info});
        }
        if (rows.isEmpty()) rows.append({"1", "", ""});
        seg->setSegs(segs); table->setRows(rows);
        if (details->isVisible() != detailsOpen) details->setVisible(detailsOpen);
    }
    QJsonObject pendingPaint;
    bool paintQueued = false;
    void queuePaint(const QJsonObject& pr) {
        pendingPaint = pr;
        if (paintQueued) return;
        paintQueued = true;
        QTimer::singleShot(0, w, [this] {
            paintQueued = false;
            render(pendingPaint);
        });
    }
    bool fitQueued = false;
    void fit() {
        if (fitQueued) return;
        fitQueued = true;
        QTimer::singleShot(0, w, [this] {
            fitQueued = false;
            sheet->layout()->activate();
            const int h = w->spec().h + sheet->sizeHint().height();
            if (w->height() != h) w->setFixedHeight(h);
        });
    }

    void render(QJsonObject pr) {
        QString st = rec.value("status").toString();
        const QJsonArray segs = pr.value("segments").toArray();
        if (st == "queued") for (const auto& v : segs) { const QJsonObject g = v.toObject(); const QString gs = g.value("status").toString();
            if (gs == "connecting" || gs == "downloading" || gs == "complete" || g.value("downloaded").toDouble() > 0) { rec["status"] = "downloading"; break; } }
        const QString ps = pr.value("status").toString(), ph = pr.value("phase").toString();
        st = rec.value("status").toString();
        if ((ph == "merging" || ps == "merging" || ps == "muxing") && st != "paused" && st != "error" && st != "complete") { rec["status"] = "merging"; st = "merging"; }
        const QString name = rec.value("fileName").toString("Download");
        w->setCaption(name); fileName->setText(name); fileName->setToolTip(name); state->setText(statusText());
        const bool merging = ph == "merging" || ps == "merging" || ps == "muxing" || st == "merging" || st == "muxing";
        const double saved = rec.value("fileSize").toDouble() + rec.value("audioSize").toDouble();
        const double reported = pr.value("total").toDouble();
        const double duration = pr.value("duration").toDouble() > 0 ? pr.value("duration").toDouble() : rec.value("duration").toDouble();
        if (duration > 0) rec["duration"] = duration;
        const double total = reported > 0 ? reported : (duration > 0 ? 0 : saved);
        double listed = 0; for (const auto& v : segs) listed += qMax(0.0, v.toObject().value("downloaded").toDouble());
        const double got = merging ? qMax(0.0, pr.value("downloaded").toDouble()) : qMax(pr.value("downloaded").toDouble(), listed);
        double pct = merging && pr.contains("percent") ? pr.value("percent").toDouble() : (total > 0 ? got / total * 100 : pr.value("percent").toDouble());
        st = rec.value("status").toString();
        if (st == "complete") pct = 100; else if (pct >= 100) pct = 99.9;
        const double speedV = pr.value("speed").toDouble();
        const bool active = st == "downloading" || st == "merging" || st == "connecting" || st == "queued";
        if (!(reported > 0) && duration > 0) { sizeLbl->setText("Duration"); fileSize->setText(progTime(duration)); }
        else { sizeLbl->setText("File size"); fileSize->setText(total > 0 ? fmtSize(total, 3) : QString::fromUtf8("\xE2\x80\x94")); }
        recvLbl->setText(merging ? "Assembled" : "Downloaded");
        const QString shownGot = got > 0 ? fmtSize(got, 3) : (merging ? "0 B" : fmtSize(got, 3));
        received->setText((merging || reported > 0 || pct > 0) ? shownGot + " (" + QString::number(pct, 'f', 2) + " %)" : shownGot);
        const bool moving = speedV >= 100;
        const QString rate = active && moving ? fmtSize(speedV, 3) + "/sec" : QString::fromUtf8("\xE2\x80\x94");
        speed->setText(rate); limitSpeed->setText(rate);
        double eta = moving ? pr.value("eta").toDouble() : 0; if (moving && !(eta > 0) && total > got) eta = (total - got) / speedV;
        left->setText(active ? progTime(eta > 0 ? eta : -1) : QString::fromUtf8("\xE2\x80\x94"));
        bool savedPieces = false; for (const auto& v : segs) { const QJsonObject g = v.toObject(); if (g.value("downloaded").toDouble() > 0 && g.value("end").toDouble(-1) >= 0) savedPieces = true; }
        double span = reported > 0 ? reported : total;
        if (!(span > 0) && pct > 0.2 && got > 0) span = got / (pct / 100.0);
        meter->setTarget(pct, speedV, span, st == "downloading");
        caption->setText(merging ? "Assembling file" : "Each connection");
        const int custom = rec.value("customThreads").toInt();
        int capSource = custom > 0 ? custom : pr.value("connections").toInt();
        if (capSource <= 0) capSource = rec.value("segments").toInt();
        if (capSource <= 0) capSource = defaultThreads;
        rowCap = qBound(0, capSource, 32);
        const bool refreshRows = !rowsAt.isValid() || rowsAt.elapsed() >= 250 || st == "paused" || st == "complete" || st == "error" || merging;
        if (refreshRows) { renderConnections(pr); rowsAt.start(); }
        const bool done = st == "complete";
        const bool canResume = savedPieces || rec.value("resumable").toBool() || rec.value("duration").toDouble() > 0 || QRegularExpression("\\.m3u8|\\.ts$", QRegularExpression::CaseInsensitiveOption).match(rec.value("fileName").toString(rec.value("url").toString())).hasMatch();
        resume->setText(canResume ? "Yes" : "No");
        const bool failed = st == "error" && !canResume;
        const bool paused = st == "paused" || (st == "error" && canResume);
        finished = done || (st == "error" && !canResume);
        meter->paused = paused; meter->update();
        mainBtn->setVisible(!failed); mainBtn->setText(done ? "Open" : (paused ? "Resume" : "Pause"));
        cancelBtn->setText(finished ? "Close" : "Cancel");
    }
    void applyStatus(const QString& st, const QJsonObject& extra = QJsonObject()) {
        if (rec.isEmpty()) rec = QJsonObject{{"id", id}};
        rec["status"] = st; for (auto it = extra.begin(); it != extra.end(); ++it) rec[it.key()] = it.value();
        render(rec.value("progress").toObject());
    }
    void showTab(int i) { for (int k = 0; k < 3; ++k) { tabs[k]->setChecked(k == i); panels[k]->setVisible(k == i); } fit(); }
    void sendFinish() { b->send("progress:set-finish", QJsonObject{{"id", id}, {"finish", QJsonObject{{"showDialog", showDialog->isChecked()}, {"power", optPower->isChecked()}, {"action", powerAction->currentData().toString()}}}}); }
    void sendThreads() { const int v = qBound(0, threads->value(), 32); rec["customThreads"] = v; rec["segments"] = v > 0 ? v : defaultThreads; b->send("progress:set-threads", QJsonObject{{"id", id}, {"threads", v}}); }
    void sendLimit() { b->send("progress:set-limit", QJsonObject{{"id", id}, {"enabled", useLimit->isChecked()}, {"kbps", limitKbps->value()}, {"remember", true}}); }
    void updateThreadNote() { const int v = threads->value(); threadNote->setText(v <= 0 ? QString("Use Global Settings (%1)").arg(defaultThreads) : QString("Custom (%1 threads)").arg(v)); }
    void runCancel(const QString& action) {
        if (action == "abandon") { b->send("download:abandon", id); w->close(); return; }
        b->send("download:pause", id); w->close();
    }
    void rememberCancel(const QString& a) { if (!askRemember->isChecked()) return; cancelAsk = false; cancelAction = a; b->invoke("settings:update", QJsonObject{{"behavior", QJsonObject{{"cancelAsk", false}, {"cancelAction", a}}}}); }
};

static TitleSpec progressSpec() { TitleSpec s; s.h = 32; s.winBg = TitleSpec::Card; s.border = false; s.buttons = 1; return s; }

ProgressDialog::ProgressDialog(Store* st, const QString& id) : FramelessWindow(progressSpec(), false, true), d(new Impl) {
    d->s = st; d->b = st->bridge(); d->id = id; d->w = this;
    setFixedWidth(460);
    Bridge* b = d->b;
    const QJsonObject data = b->invoke("progress:get", id).toObject();
    d->rec = data.value("record").toObject(); if (d->rec.isEmpty()) d->rec = QJsonObject{{"id", id}, {"status", "downloading"}, {"fileName", "Download"}, {"url", ""}};
    d->filePath = d->rec.value("path").toString();
    d->defaultThreads = data.value("globalThreads").toInt(8); d->cancelAsk = data.value("cancelAsk").toBool(true); d->cancelAction = data.value("cancelAction").toString("keep");

    d->sheet = new QWidget; auto* sv = vbox(d->sheet, 8, QMargins(10, 8, 10, 10)); sv->setAlignment(Qt::AlignTop);
    // tabs
    auto* tr = new QWidget; auto* th = hbox(tr, 4); const char* tn[3] = {"Progress", "Speed", "After download"};
    for (int i = 0; i < 3; ++i) { d->tabs[i] = new TabBtn(tn[i], tr); th->addWidget(d->tabs[i]); connect(d->tabs[i], &QAbstractButton::clicked, this, [this, i] { d->showTab(i); }); }
    th->addStretch(1); sv->addWidget(tr);
    // panel 0: status
    for (int i = 0; i < 3; ++i) { d->panels[i] = new Panel(d->sheet); }
    { auto* v = vbox(d->panels[0], 0, QMargins(2, 10, 2, 10)); v->setAlignment(Qt::AlignTop);
      auto* nr = new QWidget; auto* nh = hbox(nr, 8); d->fileName = makeLabel("", 13, 650, "t1"); d->fileName->setMinimumWidth(0); nh->addWidget(d->fileName, 1);
      d->copy = new CopyBtn(26, 16); nh->addWidget(d->copy); v->addWidget(nr); v->addSpacing(6);
      auto* g = new QGridLayout; g->setHorizontalSpacing(8); g->setVerticalSpacing(2); g->setContentsMargins(0, 0, 0, 0);
      auto row = [&](int r, QLabel* k, QLabel* val) { g->addWidget(k, r, 0); g->addWidget(val, r, 1); k->setFixedWidth(110); };
      d->state = makeLabel("Downloading", 12, 400, "t1"); d->sizeLbl = makeLabel("File size", 12, 400, "t2"); d->fileSize = makeLabel("\xE2\x80\x94", 12, 400, "t1");
      d->recvLbl = makeLabel("Downloaded", 12, 400, "t2"); d->received = makeLabel("\xE2\x80\x94", 12, 400, "t1"); d->speed = makeLabel("\xE2\x80\x94", 12, 400, "t1");
      d->left = makeLabel("\xE2\x80\x94", 12, 400, "t1"); d->resume = makeLabel("Yes", 12, 400, "t1");
      row(0, makeLabel("Status", 12, 400, "t2"), d->state); row(1, d->sizeLbl, d->fileSize); row(2, d->recvLbl, d->received);
      row(3, makeLabel("Speed", 12, 400, "t2"), d->speed); row(4, makeLabel("Time left", 12, 400, "t2"), d->left); row(5, makeLabel("Can resume", 12, 400, "t2"), d->resume);
      g->setColumnStretch(1, 1); v->addLayout(g); }
    // panel 1: speed
    { auto* v = vbox(d->panels[1], 0, QMargins(2, 10, 2, 10)); v->setAlignment(Qt::AlignTop);
      auto* g = new QWidget; auto* gh = hbox(g, 8); auto* k = makeLabel("Speed", 12, 400, "t2"); k->setFixedWidth(110); d->limitSpeed = makeLabel("\xE2\x80\x94", 12, 400, "t1"); gh->addWidget(k); gh->addWidget(d->limitSpeed, 1); v->addWidget(g);
      v->addSpacing(12);
      auto* r1 = new QWidget; auto* h1 = hbox(r1, 8); auto* c1 = new QWidget; auto* c1v = vbox(c1, 2);
      c1v->addWidget(makeLabel("Thread count", 13, 500, "t1")); d->threadNote = makeLabel("Use Global Settings", 11, 400, "muted"); c1v->addWidget(d->threadNote);
      h1->addWidget(c1, 1);
      d->threads = new QSpinBox; d->threads->setProperty("v", "num"); d->threads->setRange(0, 32); d->threads->setButtonSymbols(QAbstractSpinBox::NoButtons); d->threads->setFixedWidth(68); d->threads->setFont(Theme::uiFont(12));
      h1->addWidget(d->threads); auto* sp = new QWidget; sp->setFixedWidth(28); h1->addWidget(sp); v->addWidget(r1);
      v->addSpacing(12);
      auto* r2 = new QWidget; auto* h2 = hbox(r2, 8); d->useLimit = new ChkBox("Speed limit"); QFont lf = Theme::uiFont(12, 500); d->useLimit->setFont(lf);
      h2->addWidget(d->useLimit, 1);
      d->limitKbps = new QSpinBox; d->limitKbps->setProperty("v", "num"); d->limitKbps->setRange(1, 10000000); d->limitKbps->setValue(10); d->limitKbps->setEnabled(false);
      d->limitKbps->setButtonSymbols(QAbstractSpinBox::NoButtons); d->limitKbps->setFixedWidth(68); d->limitKbps->setFont(Theme::uiFont(12));
      h2->addWidget(d->limitKbps); auto* u = makeLabel("KB/s", 11, 400, "t2"); u->setMinimumWidth(28); h2->addWidget(u); v->addWidget(r2); }
    // panel 2: after download
    { auto* v = vbox(d->panels[2], 0, QMargins(2, 10, 2, 10)); v->setAlignment(Qt::AlignTop); v->addSpacing(6);
      d->showDialog = new ChkBox("Tell me when the file is ready"); d->showDialog->setChecked(true); v->addWidget(d->showDialog); v->addSpacing(12);
      auto* r = new QWidget; auto* h = hbox(r, 8); d->optPower = new ChkBox("Action when finished:"); h->addWidget(d->optPower);
      d->powerAction = makeCombo("sel"); d->powerAction->setEnabled(false);
      d->powerAction->addItem("Shut down", "shutdown"); d->powerAction->addItem("Sleep", "sleep"); d->powerAction->addItem("Restart", "restart"); d->powerAction->addItem("Lock", "lock");
      h->addWidget(d->powerAction); h->addStretch(1); v->addWidget(r); }
    for (int i = 0; i < 3; ++i) sv->addWidget(d->panels[i]);
    d->meter = new Meter(d->sheet); sv->addWidget(d->meter);
    // actions
    auto* ar = new QWidget; auto* ah = hbox(ar, 8);
    struct HideBtn : QAbstractButton { bool open = true; HideBtn(QWidget* p) : QAbstractButton(p) { setFixedSize(30, 26); setCursor(Qt::PointingHandCursor); setAttribute(Qt::WA_Hover); setFocusPolicy(Qt::NoFocus); }
        void paintEvent(QPaintEvent*) override { const Tokens& t = Theme::I().t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
            QPainterPath o; o.addRoundedRect(QRectF(rect()), 4, 4); p.fillPath(o, t.border2);
            QPainterPath i; i.addRoundedRect(QRectF(rect()).adjusted(1, 1, -1, -1), 3, 3); p.fillPath(i, underMouse() ? t.hover : t.bg3);
            p.translate(width() / 2.0, height() / 2.0); if (!open) p.scale(1, -1);
            p.setPen(QPen(t.t1, 2.2 * 14 / 24.0, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin)); p.drawPolyline(QPolygonF({{-3.5, -1.75}, {0, 1.75}, {3.5, -1.75}})); } };
    auto* hb = new HideBtn(ar); d->hideBtn = hb; ah->addWidget(hb); ah->addStretch(1);
    auto mk = [&](const QString& t) { auto* x = new PushButton(PushButton::Win, t); x->metrics(8, 4, 4, 400).fixed(96, 26); return x; };
    d->mainBtn = mk("Pause"); d->cancelBtn = mk("Cancel"); ah->addWidget(d->mainBtn); ah->addWidget(d->cancelBtn); sv->addWidget(ar);
    // details
    d->details = new QWidget; auto* dv = vbox(d->details, 0);
    d->caption = makeLabel("Each connection", 12, 400, "t2"); d->caption->setAlignment(Qt::AlignCenter); dv->addWidget(d->caption);
    d->seg = new SegBar(d->details); dv->addWidget(d->seg); d->table = new ConnTable(d->details); dv->addWidget(d->table);
    sv->addWidget(d->details);
    auto* root = vbox(body(), 0); root->addWidget(d->sheet);

    // cancel-ask overlay
    struct Dim : QWidget { using QWidget::QWidget; void paintEvent(QPaintEvent*) override { QPainter p(this); p.fillRect(rect(), QColor(0, 0, 0, int(255 * .45))); } };
    auto* dim = new Dim(this); d->askOverlay = dim; dim->hide();
    {
      struct Card : QWidget { using QWidget::QWidget; void paintEvent(QPaintEvent*) override { const Tokens& t = Theme::I().t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
          QPainterPath o; o.addRoundedRect(QRectF(rect()), 8, 8); p.fillPath(o, t.border); QPainterPath i; i.addRoundedRect(QRectF(rect()).adjusted(1, 1, -1, -1), 7, 7); p.fillPath(i, t.bg2); } };
      auto* c = new Card(dim); c->setFixedWidth(420);
      auto* cv = vbox(c, 0, QMargins(14, 14, 14, 14));
      auto* msg = makeLabel("Keep pauses the download and leaves the pieces. Cancel download deletes the pieces and leaves the file in the list as not downloaded.", 12, 400, "t1"); msg->setWordWrap(true); cv->addWidget(msg); cv->addSpacing(10);
      d->askRemember = new ChkBox("Remember my choice and don't show again"); cv->addWidget(d->askRemember); cv->addSpacing(12);
      auto* ah2 = new QWidget; auto* h = hbox(ah2, 8); h->addStretch(1);
      auto* yes = new PushButton(PushButton::Win, "Cancel download"); yes->metrics(8, 4, 4, 400).fixed(124, 26); auto* keep = new PushButton(PushButton::Win, "Keep"); keep->metrics(8, 4, 4, 400).fixed(124, 26);
      h->addWidget(yes); h->addWidget(keep); cv->addWidget(ah2);
      auto* dl = new QVBoxLayout(dim); dl->addWidget(c, 0, Qt::AlignCenter);
      connect(yes, &QAbstractButton::clicked, this, [this] { d->rememberCancel("abandon"); d->runCancel("abandon"); });
      connect(keep, &QAbstractButton::clicked, this, [this] { d->rememberCancel("keep"); d->runCancel("keep"); }); }

    // wiring (ports of the JS listeners)
    connect(d->hideBtn, &QAbstractButton::clicked, this, [this, hb] { d->detailsOpen = !d->detailsOpen; hb->open = d->detailsOpen; hb->update(); d->details->setVisible(d->detailsOpen); d->fit(); });
    connect(d->mainBtn, &QAbstractButton::clicked, this, [this] {
        const QString st = d->rec.value("status").toString();
        if (st == "complete") { if (!d->filePath.isEmpty()) d->b->send("download:open-file", d->filePath); return; }
        if (st == "paused" || st == "error") { d->userHold = false; d->rec["status"] = "downloading"; d->rec["error"] = ""; d->rec["errorTitle"] = ""; d->render(d->rec.value("progress").toObject()); d->b->send("download:resume", d->id); }
        else { d->userHold = true; d->rec["status"] = "paused"; d->b->send("download:pause", d->id); d->render(d->rec.value("progress").toObject()); }
    });
    connect(d->cancelBtn, &QAbstractButton::clicked, this, [this] {
        if (d->finished) { close(); return; }
        if (!d->cancelAsk) { d->runCancel(d->cancelAction); return; }
        d->askOverlay->setGeometry(rect()); d->askOverlay->raise(); d->askOverlay->show();
    });
    connect(d->useLimit, &QCheckBox::toggled, this, [this](bool on) { d->limitKbps->setEnabled(on); d->sendLimit(); });
    connect(d->limitKbps, &QSpinBox::editingFinished, this, [this] { d->sendLimit(); });
    connect(d->threads, qOverload<int>(&QSpinBox::valueChanged), this, [this] { d->updateThreadNote(); });
    connect(d->threads, &QSpinBox::editingFinished, this, [this] { d->updateThreadNote(); d->sendThreads(); });
    connect(d->showDialog, &QCheckBox::toggled, this, [this] { d->sendFinish(); });
    connect(d->optPower, &QCheckBox::toggled, this, [this](bool on) { d->powerAction->setEnabled(on); d->sendFinish(); });
    connect(d->powerAction, qOverload<int>(&QComboBox::currentIndexChanged), this, [this] { d->sendFinish(); });
    connect(d->copy, &QAbstractButton::clicked, this, [this] { const QString u = d->rec.value("url").toString(); if (!u.isEmpty()) { QApplication::clipboard()->setText(u); d->copy->flashCopied(); } });
    connect(b, &Bridge::event, this, [this](const QString& ch, const QJsonValue& v) {
        const QJsonObject o = v.toObject(); if (o.value("id").toString() != d->id) return;
        if (ch == "download:progress") {
            if (d->userHold) return;
            QString st = d->rec.value("status").toString();
            if (st == "complete") { if (o.value("status").toString() == "downloading" || (o.contains("percent") && o.value("percent").toDouble() < 100)) d->rec["status"] = "downloading"; else return; }
            if (d->rec.value("status").toString() != "paused") {
                if (o.value("phase").toString() == "merging" || o.value("status").toString() == "merging" || o.value("status").toString() == "muxing") d->rec["status"] = "merging";
                else if (d->rec.value("status").toString() != "error" && d->rec.value("status").toString() != "merging") d->rec["status"] = "downloading";
            }
            d->rec["progress"] = o; d->queuePaint(o);
        } else if (ch == "download:metadata") {
            for (const char* k : {"url", "fileName", "fileSize", "duration"}) if (!o.value(k).isUndefined() && !o.value(k).toVariant().toString().isEmpty()) d->rec[k] = o.value(k);
            if (o.contains("resumable")) d->rec["resumable"] = o.value("resumable").toBool();
            d->render(d->rec.value("progress").toObject());
        } else if (ch == "download:paused") { d->userHold = true; d->applyStatus("paused"); }
        else if (ch == "download:resumed") { d->userHold = false; d->rec["error"] = ""; d->rec["errorTitle"] = ""; d->applyStatus("downloading"); }
        else if (ch == "download:complete") {
            d->filePath = o.value("path").toString(d->filePath); d->rec["path"] = d->filePath; d->rec["status"] = "complete";
            QJsonObject pr = d->rec.value("progress").toObject(); pr["percent"] = 100; d->rec["progress"] = pr; d->render(pr);
            d->state->setText("Complete"); d->left->setText("0 sec"); d->mainBtn->setText("Open"); d->cancelBtn->setText("Close");
            QTimer::singleShot(450, this, [this] { d->b->send("progress:reveal-complete", d->id); close(); });
        } else if (ch == "download:error") d->applyStatus("error", QJsonObject{{"error", o.value("error")}, {"errorTitle", o.value("errorTitle")}});
    });

    if (d->rec.value("speedLimit").isObject()) { const QJsonObject sl = d->rec.value("speedLimit").toObject(); d->useLimit->setChecked(sl.value("enabled").toBool()); if (sl.value("kbps").toInt() > 0) d->limitKbps->setValue(sl.value("kbps").toInt()); d->limitKbps->setEnabled(d->useLimit->isChecked()); }
    d->threads->setValue(qMax(0, d->rec.value("customThreads").toInt())); d->updateThreadNote();
    const QJsonObject fin = d->rec.value("finish").toObject();
    if (!fin.isEmpty()) { if (fin.contains("showDialog")) d->showDialog->setChecked(fin.value("showDialog").toBool()); d->optPower->setChecked(fin.value("power").toBool());
        const int i = d->powerAction->findData(fin.value("action").toString()); if (i >= 0) d->powerAction->setCurrentIndex(i); d->powerAction->setEnabled(d->optPower->isChecked()); }
    d->sendFinish();
    d->showTab(0);
    d->render(data.value("progress").toObject());
    d->fit();
}
