#include "Dialogs.h"
#include <cmath>

namespace {
const char* kDayKey[7] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};

class Studio : public QWidget {                       // .studio: radial-gradient(1200px 240px at 10% -10%, glow, transparent 55%) over --bg-secondary
public:
    Studio(QWidget* p) : QWidget(p) { connect(&Theme::I(), &Theme::changed, this, [this] { update(); }); }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(this);
        p.fillRect(rect(), t.bg2);
        p.save(); p.translate(width() * 0.1, height() * -0.1); p.scale(1.0, 240.0 / 1200.0);
        QRadialGradient g(0, 0, 1200); QColor gl = t.glow, tr = t.glow; tr.setAlpha(0);
        g.setColorAt(0, gl); g.setColorAt(0.55, tr); g.setColorAt(1, tr);
        p.fillRect(p.worldTransform().inverted().mapRect(QRectF(rect())), QBrush(g));
        p.restore();
    }
};
class Rail : public QWidget {                         // .scheduler-rail (bg primary, border-right)
public:
    Rail(QWidget* p) : QWidget(p) { setFixedWidth(250); }
protected:
    void paintEvent(QPaintEvent*) override { QPainter p(this); const Tokens& t = Theme::I().t(); p.fillRect(rect(), t.bg1); p.fillRect(QRect(width() - 1, 0, 1, height()), t.border); }
};
class QueueItem : public QAbstractButton {            // .queue-item
public:
    QueueItem(const QString& text, const QColor& mark, QWidget* p) : QAbstractButton(p), m_mark(mark) { setText(text); setAttribute(Qt::WA_Hover); setCursor(Qt::PointingHandCursor); setCheckable(true); setFocusPolicy(Qt::NoFocus); }
    QSize sizeHint() const override { return {100, 8 + QFontMetrics(Theme::uiFont(13)).lineSpacing() + 8}; }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        QPainterPath pp; pp.addRoundedRect(QRectF(rect()), 10, 10);
        if (isChecked()) p.fillPath(pp, t.glow); else if (underMouse()) p.fillPath(pp, t.hover);
        const QPointF c(10 + 4, height() / 2.0);
        for (int i = 4; i >= 1; --i) { QColor g = m_mark; g.setAlphaF(0.10 * (5 - i) / 4.0); p.setPen(Qt::NoPen); p.setBrush(g); p.drawEllipse(c, 4 + i, 4 + i); }
        p.setBrush(m_mark); p.drawEllipse(c, 4, 4);
        p.setFont(Theme::uiFont(13)); p.setPen(isChecked() ? t.t1 : t.t2);
        p.drawText(QRect(10 + 8 + 8, 0, width() - 36, height()), Qt::AlignVCenter, QFontMetrics(p.font()).elidedText(text(), Qt::ElideRight, width() - 36));
    }
private:
    QColor m_mark;
};
class Pill : public QAbstractButton {                 // .studio-tabs button
public:
    Pill(const QString& t, QWidget* p) : QAbstractButton(p) { setText(t); setCheckable(true); setCursor(Qt::PointingHandCursor); setFocusPolicy(Qt::NoFocus); }
    QSize sizeHint() const override { return {QFontMetrics(Theme::uiFont(13)).horizontalAdvance(text()) + 24, 8 + QFontMetrics(Theme::uiFont(13)).lineSpacing() + 8}; }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        if (isChecked()) { QPainterPath pp; pp.addRoundedRect(QRectF(rect()), height() / 2.0, height() / 2.0); p.fillPath(pp, t.active); }
        p.setFont(Theme::uiFont(13)); p.setPen(isChecked() ? t.accent : t.t2); p.drawText(rect(), Qt::AlignCenter, text());
    }
};
class DayChip : public QAbstractButton {              // .day-chips button
public:
    DayChip(const QString& t, QWidget* p) : QAbstractButton(p) { setText(t); setCheckable(true); setCursor(Qt::PointingHandCursor); setFocusPolicy(Qt::NoFocus); }
    QSize sizeHint() const override { const QFontMetrics fm(Theme::uiFont(12)); return {fm.horizontalAdvance(text()) + 20 + 2, 5 + fm.lineSpacing() + 5 + 2}; }
protected:
    void paintEvent(QPaintEvent*) override {
        const Theme& th = Theme::I(); const Tokens& t = th.t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        const QRectF r(rect()); const qreal rad = height() / 2.0;
        QPainterPath o; o.addRoundedRect(r, rad, rad);
        QColor fg = t.t2;
        if (isChecked() && th.is3()) {
            p.fillPath(o, th.accentBrush(r)); const QRectF in = r.adjusted(1.5, 1.5, -1.5, -1.5);
            QPainterPath i; i.addRoundedRect(in, rad - 1.5, rad - 1.5); p.fillPath(i, t.card);
            p.setFont(Theme::uiFont(12)); drawGradText(p, r, r, text(), p.font(), Qt::AlignHCenter); return;
        }
        if (isChecked()) { p.fillPath(o, th.accentBrush(r)); fg = th.id() == "theme2" ? QColor(Qt::white) : QColor("#111111"); }
        else { p.fillPath(o, t.border); QPainterPath i; i.addRoundedRect(r.adjusted(1, 1, -1, -1), rad - 1, rad - 1); p.fillPath(i, t.bg2); }
        p.setFont(Theme::uiFont(12)); p.setPen(fg); p.drawText(rect(), Qt::AlignCenter, text());
    }
};
class StepBtn : public QAbstractButton {              // .queue-file-actions button (36x32)
public:
    StepBtn(const QString& g, bool danger, QWidget* p) : QAbstractButton(p), m_g(g), m_d(danger) { setFixedSize(36, 32); setCursor(Qt::PointingHandCursor); setAttribute(Qt::WA_Hover); setFocusPolicy(Qt::NoFocus); }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        QPainterPath o; o.addRoundedRect(QRectF(rect()), 8, 8); p.fillPath(o, t.border2);
        QPainterPath i; i.addRoundedRect(QRectF(rect()).adjusted(1, 1, -1, -1), 7, 7); p.fillPath(i, underMouse() ? t.glow : t.bg1);
        p.setFont(Theme::uiFont(16)); p.setPen(m_d ? t.danger : t.accent); p.drawText(rect(), Qt::AlignCenter, m_g);
    }
private:
    QString m_g; bool m_d;
};
QString fmt1(double b) { if (!(b > 0)) return QString::fromUtf8("\xE2\x80\x94"); static const char* u[] = {"B", "KB", "MB", "GB", "TB"}; int i = qMin(4, int(std::floor(std::log(b) / std::log(1024.0)))); if (i < 0) i = 0; return QString::number(b / std::pow(1024.0, i), 'f', 1) + " " + u[i]; }

class FileTable : public QWidget {                    // .file-table (grid minmax(0,1fr) 90px 100px 80px) with drag reorder
public:
    FileTable(QueueEngine* q, QWidget* p) : QWidget(p), m_q(q) { setMouseTracking(true); setFocusPolicy(Qt::NoFocus); }
    std::function<void(const QString&, const QString&, bool)> onMove; std::function<void()> onSelect;
    QSize sizeHint() const override { return {400, (m_n + 1) * 33}; }
    void reload() { const Queue* qu = m_q->byId(m_q->activeId); m_rows = qu ? m_q->filesFor(*qu) : QVector<QJsonObject>(); m_n = m_rows.size(); setMinimumHeight((m_n + 1) * 33); updateGeometry(); update(); }
protected:
    int rowAt(int y) const { const int i = y / 33 - 1; return i >= 0 && i < m_n ? i : -1; }
    void mousePressEvent(QMouseEvent* e) override { const int r = rowAt(e->pos().y()); if (r >= 0) { m_q->selectedFile = m_rows[r].value("id").toString(); m_press = e->pos(); m_src = m_q->selectedFile; if (onSelect) onSelect(); update(); } }
    void mouseMoveEvent(QMouseEvent* e) override {
        if (!(e->buttons() & Qt::LeftButton) || m_src.isEmpty()) return;
        if (!m_drag && (e->pos() - m_press).manhattanLength() < 6) return;
        m_drag = true; setCursor(Qt::ClosedHandCursor);
        const int r = rowAt(e->pos().y()); m_tgt = r; m_after = r >= 0 && (e->pos().y() % 33) >= 16; update();
    }
    void mouseReleaseEvent(QMouseEvent*) override {
        if (m_drag && m_tgt >= 0 && onMove) onMove(m_src, m_rows[m_tgt].value("id").toString(), m_after);
        m_drag = false; m_src.clear(); m_tgt = -1; unsetCursor(); update();
    }
    void paintEvent(QPaintEvent*) override {
        const Theme& th = Theme::I(); const Tokens& t = th.t(); QPainter p(this);
        const double W = width(); const double c1 = W - 90 - 100 - 80;
        const double xs[4] = {0, c1, c1 + 90, c1 + 190};
        const double ws[4] = {c1, 90, 100, 80};
        auto line = [&](int y) { p.fillRect(QRect(0, y + 32, width(), 1), t.border); };
        const QFont fb = Theme::uiFont(12, 600), fn = Theme::uiFont(12);
        const char* hd[4] = {"File name", "Size", "Status", "Progress"};
        for (int c = 0; c < 4; ++c) { p.setFont(fb); p.setPen(t.muted); p.drawText(QRectF(xs[c] + 10, 0, ws[c] - 20, 32), Qt::AlignVCenter, hd[c]); }
        line(0);
        for (int i = 0; i < m_n; ++i) {
            const QJsonObject& d = m_rows[i]; const int y = (i + 1) * 33; const QRect row(0, y, width(), 33);
            const bool sel = d.value("id").toString() == m_q->selectedFile;
            if (sel) p.fillRect(row, th.selBrush(QRectF(row))); else if (row.contains(mapFromGlobal(QCursor::pos())) && !m_drag) p.fillRect(row, t.hover);
            if (m_drag && d.value("id").toString() == m_src) p.fillRect(row, QColor(t.active.red(), t.active.green(), t.active.blue(), 115));
            const double pct = d.value("progress").toObject().value("percent").toDouble(-1);
            const QStringList cells = {d.value("fileName").toString("Unknown"), fmt1(d.value("fileSize").toDouble() > 0 ? d.value("fileSize").toDouble() : d.value("progress").toObject().value("total").toDouble()),
                                       d.value("status").toString(), d.value("progress").toObject().contains("percent") ? QString::number(pct) + "%" : QString::fromUtf8("\xE2\x80\x94")};
            for (int c = 0; c < 4; ++c) { p.setFont(fn); p.setPen(t.t1); p.drawText(QRectF(xs[c] + 10, y, ws[c] - 20, 32), Qt::AlignVCenter, QFontMetrics(fn).elidedText(cells[c], Qt::ElideRight, int(ws[c] - 20))); }
            line(y);
            if (m_drag && i == m_tgt) p.fillRect(QRect(0, m_after ? y + 31 : y, width(), 2), t.accent);
        }
    }
private:
    QueueEngine* m_q; QVector<QJsonObject> m_rows; int m_n = 0, m_tgt = -1; bool m_drag = false, m_after = false; QPoint m_press; QString m_src;
};
}

struct SchedulerDialog::Impl {
    QueueEngine* q; Store* s; SchedulerDialog* w;
    QVBoxLayout* rail; QLabel* heading; Pill* tabs[2]; QWidget* tabsBox; QWidget* paneHost; QLabel* help; PushButton *start, *stop, *apply, *delBtn;
    QScrollArea* scroll; QLineEdit* nameInput; QWidget* nameForm; QueueItem* items[64]; QVector<QString> itemIds; QueueItem* limItem;
    // schedule pane controls
    RadBox *modeOnce = nullptr, *modePer = nullptr, *whenOnce = nullptr, *whenDaily = nullptr; ChkBox *launch = nullptr, *startOn = nullptr, *everyOn = nullptr, *stopOn = nullptr, *retryOn = nullptr, *openOn = nullptr, *exitApp = nullptr, *shutdown = nullptr;
    QTimeEdit *startAt = nullptr, *stopAt = nullptr; QSpinBox *everyH = nullptr, *everyM = nullptr, *retryN = nullptr, *conc = nullptr, *limMb = nullptr, *limHours = nullptr; QDateEdit* onceDate = nullptr;
    DayChip* day[7] = {}; QLineEdit* openPath = nullptr; QComboBox* power = nullptr; ChkBox *limOn = nullptr, *limWarn = nullptr; FileTable* ftable = nullptr; bool paneLive = false;

    Queue* cur() { Queue* c = q->byId(q->activeId); return c ? c : &q->queues[0]; }
    static QTime tm(const QString& s) { return QTime::fromString(s, "HH:mm").isValid() ? QTime::fromString(s, "HH:mm") : QTime(0, 0); }

    void readPane() {
        if (!paneLive) return;
        if (q->activeId == "limits") { if (!limMb) return; q->limits.enabled = limOn->isChecked(); q->limits.mb = qMax(1, limMb->value()); q->limits.hours = qMax(1, limHours->value()); q->limits.warn = limWarn->isChecked(); return; }
        if (q->tab != "schedule" || !startAt) return;
        Queue* c = cur();
        c->mode = modePer->isChecked() ? "periodic" : "once"; c->startOnLaunch = launch->isChecked(); c->startAtEnabled = startOn->isChecked(); c->startAt = startAt->time().toString("HH:mm");
        c->when = (whenOnce && whenOnce->isChecked()) ? "once" : "daily"; if (onceDate) c->onceDate = onceDate->date().toString(Qt::ISODate);
        for (int i = 0; i < 7; ++i) if (day[i]) c->days[i] = day[i]->isChecked();
        if (everyOn) { c->everyEnabled = everyOn->isChecked(); c->everyHours = qMax(0, everyH->value()); c->everyMins = qMax(0, everyM->value()); }
        c->stopAtEnabled = stopOn->isChecked(); c->stopAt = stopAt->time().toString("HH:mm"); c->retriesEnabled = retryOn->isChecked(); c->retries = qMax(0, retryN->value());
        c->openFileEnabled = openOn->isChecked(); c->openFile = openPath->text(); c->hangup = false; c->exitApp = exitApp->isChecked(); c->shutdown = shutdown->isChecked();
        c->shutdownAction = power->currentData().toString(); c->forceTerminate = false;
    }
    void lockControls() {
        if (!startOn) return;
        startAt->setEnabled(startOn->isChecked()); stopAt->setEnabled(stopOn->isChecked()); retryN->setEnabled(retryOn->isChecked()); openPath->setEnabled(openOn->isChecked());
        if (everyOn) { everyH->setEnabled(everyOn->isChecked()); everyM->setEnabled(everyOn->isChecked()); }
        if (onceDate && whenOnce) onceDate->setEnabled(whenOnce->isChecked());
    }
    QWidget* kicker(const QString& t) { auto* l = makeLabel(t.toUpper(), 12, 650, "accent"); QFont f = l->font(); f.setLetterSpacing(QFont::AbsoluteSpacing, 0.48); l->setFont(f); return l; }
    template <class W> W* styled(W* e) { if constexpr (std::is_same_v<W, QComboBox>) { e->setView(new QListView(e)); } e->setProperty("v", "studio"); e->setFont(Theme::uiFont(12)); return e; }
    QWidget* srow(std::initializer_list<QWidget*> ws) { auto* r = new QWidget; auto* h = hbox(r, 8); for (auto* x : ws) h->addWidget(x); h->addStretch(1); return r; }
    ChkBox* chk(const QString& t, bool on) { auto* c = new ChkBox(t); c->setFont(Theme::uiFont(13)); c->setChecked(on); return c; }
    RadBox* rad(const QString& t, bool on) { auto* c = new RadBox(t); c->setFont(Theme::uiFont(13)); c->setChecked(on); return c; }
    QSpinBox* spin(int lo, int hi, int v) { auto* s2 = styled(new QSpinBox); s2->setRange(lo, hi); s2->setValue(v); s2->setButtonSymbols(QAbstractSpinBox::NoButtons); s2->setFixedWidth(64); return s2; }
    QTimeEdit* timeEd(const QString& v) { auto* t = styled(new QTimeEdit(tm(v))); t->setDisplayFormat("HH:mm"); t->setFixedWidth(90); return t; }
    QWidget* dayChips(const Queue& c) { auto* r = new QWidget; auto* h = hbox(r, 6, QMargins(0, 6, 0, 10)); for (int i = 0; i < 7; ++i) { day[i] = new DayChip(kDayKey[i], r); day[i]->setChecked(c.days[i]); h->addWidget(day[i]); } h->addStretch(1); return r; }

    void paintQueues() {
        for (int i = 0; i < itemIds.size(); ++i) items[i]->setChecked(itemIds[i] == q->activeId);
        limItem->setChecked(q->activeId == "limits");
        delBtn->setEnabled(!(q->activeId == "limits" || q->activeId == "main" || q->activeId == "sync"));
    }
    void paintActions() {
        bool st = false, sp = false; for (const auto& d : s->list()) { const QString x = d.value("status").toString(); st |= (x == "paused" || x == "error" || x == "queued"); sp |= (x == "downloading" || x == "merging"); }
        start->setEnabled(st); stop->setEnabled(sp);
    }
    void rebuildRail() {
        const QString keep = q->activeId;
        for (int i = 0; i < itemIds.size(); ++i) { rail->removeWidget(items[i]); items[i]->deleteLater(); } itemIds.clear();
        rail->removeWidget(limItem);
        int n = 0;
        for (const Queue& qu : q->queues) {
            const QColor mark = qu.kind == "main" ? QColor("#3dd6ff") : qu.kind == "sync" ? QColor("#7dffa1") : QColor("#c9a6ff");
            auto* it = new QueueItem(qu.name, mark, w); rail->insertWidget(1 + n, it); items[n++] = it; itemIds << qu.id;
            const QString id = qu.id; connect(it, &QAbstractButton::clicked, w, [this, id] { show(id); });
            if (n >= 63) break;
        }
        rail->insertWidget(1 + n, limItem);
        q->activeId = keep; paintQueues();
    }
    void paintPane() {
        paneLive = false;
        delete paneHost; paneHost = new QWidget; paneHost->setAutoFillBackground(false); paneHost->setStyleSheet("background: transparent;"); scroll->setWidget(paneHost);
        ftable = nullptr; modeOnce = modePer = whenOnce = whenDaily = nullptr; launch = startOn = everyOn = stopOn = retryOn = openOn = exitApp = shutdown = nullptr; startAt = stopAt = nullptr;
        everyH = everyM = retryN = conc = limMb = limHours = nullptr; onceDate = nullptr; openPath = nullptr; power = nullptr; limOn = limWarn = nullptr; for (auto& d : day) d = nullptr;
        const bool lim = q->activeId == "limits";
        tabsBox->setVisible(!lim);                                              // visibility:hidden keeps the space in CSS
        heading->setText(lim ? "Data cap" : cur()->name);
        for (int i = 0; i < 2; ++i) tabs[i]->setChecked((i == 0) == (q->tab == "schedule"));
        auto* v = vbox(paneHost, 8, QMargins(18, 16, 18, 24)); v->setAlignment(Qt::AlignTop);
        if (lim) {
            limOn = chk("Limit how much can download", q->limits.enabled); v->addWidget(limOn);
            auto* mb = limMb = spin(1, 100000000, q->limits.mb); limHours = spin(1, 100000, q->limits.hours);
            auto* l1 = makeLabel("No more than", 13, 400, "t1"); auto* l2 = makeLabel("MB", 13, 400, "t1"); auto* l3 = makeLabel("in", 13, 400, "t1"); auto* l4 = makeLabel("hours", 13, 400, "t1");
            v->addWidget(srow({l1, mb, l2, l3, limHours, l4}));
            limWarn = chk("Ask me before this limit pauses downloads", q->limits.warn); v->addWidget(limWarn);
            for (auto* c : {limOn, limWarn}) connect(c, &QCheckBox::toggled, w, [this] { readPane(); });
            paneLive = true; return;
        }
        if (q->tab == "files") {
            auto* r = new QWidget; auto* h = hbox(r, 8); h->addWidget(makeLabel("Run", 13, 400, "t1")); conc = spin(1, 10, q->concurrent); h->addWidget(conc); h->addWidget(makeLabel("files together", 13, 400, "t1")); h->addStretch(1);
            v->addWidget(r);
            ftable = new FileTable(q, paneHost); ftable->reload(); v->addWidget(ftable);
            auto* ar = new QWidget; auto* ah = hbox(ar, 8, QMargins(0, 10, 0, 2)); auto* dn = new StepBtn(QString::fromUtf8("\xE2\x86\x93"), false, ar); auto* up = new StepBtn(QString::fromUtf8("\xE2\x86\x91"), false, ar); auto* rm = new StepBtn(QString::fromUtf8("\xE2\x9C\x95"), true, ar);
            ah->addWidget(dn); ah->addWidget(up); ah->addWidget(rm); ah->addStretch(1); v->addWidget(hsep("1")); v->addWidget(ar);
            ftable->onSelect = [this] { };
            ftable->onMove = [this](const QString& src, const QString& tgt, bool after) {
                Queue* c = cur(); if (src == tgt) return; q->materialize(*c); QStringList ids = c->fileIds; const int from = ids.indexOf(src); if (from < 0) return;
                ids.removeAt(from); int to = ids.indexOf(tgt); if (to < 0) to = ids.size(); else if (after) ++to; ids.insert(to, src); c->fileIds = ids; q->selectedFile = src; q->remember(); ftable->reload();
            };
            auto move = [this](int dir) { Queue* c = cur(); if (q->selectedFile.isEmpty()) return; q->materialize(*c); const int i = c->fileIds.indexOf(q->selectedFile), n = i + dir; if (i < 0 || n < 0 || n >= c->fileIds.size()) return; c->fileIds.swapItemsAt(i, n); q->remember(); ftable->reload(); };
            connect(dn, &QAbstractButton::clicked, w, [move] { move(1); }); connect(up, &QAbstractButton::clicked, w, [move] { move(-1); });
            connect(rm, &QAbstractButton::clicked, w, [this] { Queue* c = cur(); if (q->selectedFile.isEmpty()) return; const QString id = q->selectedFile; c->fileIds.removeAll(id); if (!q->removed.contains(id)) q->removed << id; q->selectedFile.clear(); q->remember(); ftable->reload(); });
            connect(conc, qOverload<int>(&QSpinBox::valueChanged), w, [this](int n) { q->concurrent = qBound(1, n, 10); s->bridge()->send("queue:set-limit", q->concurrent); q->remember(); });
            paneLive = true; return;
        }
        Queue& c = *cur(); const bool per = c.mode == "periodic";
        v->addWidget(kicker("When it runs"));
        modeOnce = rad("Run this queue once", !per); modePer = rad("Repeat this queue", per); auto* grp = new QButtonGroup(paneHost); grp->addButton(modeOnce); grp->addButton(modePer);
        v->addWidget(srow({modeOnce})); v->addWidget(srow({modePer}));
        launch = chk("Also run it when ZDM opens", c.startOnLaunch); v->addWidget(srow({launch}));
        startOn = chk("Begin at", c.startAtEnabled); startAt = timeEd(c.startAt); v->addWidget(srow({startOn, startAt}));
        if (per) {
            everyOn = chk("Repeat every", c.everyEnabled); everyH = spin(0, 168, c.everyHours); everyM = spin(0, 59, c.everyMins);
            v->addWidget(srow({everyOn, everyH, makeLabel("hours", 13, 400, "t1"), everyM, makeLabel("min", 13, 400, "t1")}));
            v->addWidget(kicker("On these days")); v->addWidget(dayChips(c));
        } else {
            whenOnce = rad("On this date", c.when == "once"); onceDate = styled(new QDateEdit(QDate::fromString(c.onceDate, Qt::ISODate))); onceDate->setDisplayFormat("yyyy-MM-dd"); onceDate->setCalendarPopup(true); onceDate->setFixedWidth(120);
            whenDaily = rad("On selected days", c.when == "daily"); auto* g2 = new QButtonGroup(paneHost); g2->addButton(whenOnce); g2->addButton(whenDaily);
            v->addWidget(srow({whenOnce, onceDate})); v->addWidget(srow({whenDaily})); v->addWidget(dayChips(c));
        }
        stopOn = chk("Pause at", c.stopAtEnabled); stopAt = timeEd(c.stopAt); v->addWidget(srow({stopOn, stopAt}));
        v->addWidget(kicker("If a file fails"));
        retryOn = chk("Try again", c.retriesEnabled); retryN = spin(0, 99, c.retries); v->addWidget(srow({retryOn, retryN, makeLabel("times", 13, 400, "t1")}));
        v->addWidget(kicker("When the queue finishes"));
        openOn = chk("Open a file", c.openFileEnabled); v->addWidget(srow({openOn}));
        auto* pr = new QWidget; auto* ph = hbox(pr, 8); openPath = styled(new QLineEdit(c.openFile)); auto* br = new PushButton(PushButton::Secondary, "Browse"); ph->addWidget(openPath, 1); ph->addWidget(br); v->addWidget(pr);
        exitApp = chk("Quit ZDM", c.exitApp); v->addWidget(srow({exitApp}));
        shutdown = chk("Then", c.shutdown); power = styled(new QComboBox); power->addItem("Sleep", "sleep"); power->addItem("Shut down", "shutdown"); power->setCurrentIndex(power->findData(c.shutdownAction.isEmpty() ? "sleep" : c.shutdownAction)); if (power->currentIndex() < 0) power->setCurrentIndex(0);
        v->addWidget(srow({shutdown, power}));
        lockControls(); paneLive = true;
        connect(br, &QAbstractButton::clicked, w, [this] { const QString f = s->bridge()->invoke("shell:pick-file").toString(); if (!f.isEmpty()) openPath->setText(f); });
        for (QAbstractButton* b2 : {static_cast<QAbstractButton*>(modeOnce), static_cast<QAbstractButton*>(modePer)}) connect(b2, &QAbstractButton::clicked, w, [this] { readPane(); QTimer::singleShot(0, w, [this] { paintPane(); }); });
        for (QAbstractButton* b2 : paneHost->findChildren<QAbstractButton*>()) if (b2 != modeOnce && b2 != modePer) connect(b2, &QAbstractButton::toggled, w, [this] { readPane(); lockControls(); });
        for (auto* e : paneHost->findChildren<QLineEdit*>()) connect(e, &QLineEdit::textChanged, w, [this] { readPane(); });
    }
    void show(const QString& id) { readPane(); q->activeId = id; if (id == "limits") q->tab = "schedule"; paintQueues(); paintPane(); paintActions(); }
    void save() {
        readPane();
        QJsonArray qa; for (const Queue& qu : q->queues) qa.append(qu.toJson());
        q->remember();
        s->bridge()->invoke("settings:update", QJsonObject{{"speed", QJsonObject{{"limitEnabled", q->limits.enabled}, {"limitMB", q->limits.mb}, {"limitHours", q->limits.hours}, {"warnBeforeStop", q->limits.warn}}}});
        const QString old = apply->text(); apply->setText("Saved"); QTimer::singleShot(900, w, [this, old] { apply->setText(old); });
    }
};

SchedulerDialog::SchedulerDialog(QueueEngine* q, Store* s)
    : FramelessWindow([] { TitleSpec t; t.h = 34; t.caption = "Scheduler - Zetta Download Manager"; t.border = true; t.buttons = 1; return t; }(), true, false), d(new Impl) {
    d->q = q; d->s = s; d->w = this; resize(860, 600); setMinimumSize(680, 460);
    auto* studio = new Studio(this); auto* sv = vbox(body(), 0); sv->addWidget(studio);
    auto* col = vbox(studio, 0);
    // top
    auto* top = new QWidget; auto* th = hbox(top, 12, QMargins(16, 10, 16, 10));
    struct TitleIcon : QWidget { TitleIcon(QWidget* p) : QWidget(p) { setFixedSize(36, 36); } void paintEvent(QPaintEvent*) override { QPainter p(this); drawPm(p, Theme::I().icon("scheduler.png", Use::Plain, 36), QRectF(rect())); } };
    th->addWidget(new TitleIcon(top));
    auto* tc = new QWidget; auto* tv = vbox(tc, 0); tv->addWidget(makeLabel("Scheduler", 15, 700, "t1")); tv->addWidget(makeLabel("When queues run, and when they stop", 12, 400, "t2")); th->addWidget(tc); th->addStretch(1);
    col->addWidget(top); col->addWidget(hsep("1"));
    // body
    auto* row = new QWidget; auto* rh = hbox(row, 0);
    auto* railW = new Rail(row); d->rail = vbox(railW, 2, QMargins(12, 12, 12, 12));
    auto* rl = makeLabel("QUEUES", 11, 400, "muted"); { QFont f = rl->font(); f.setLetterSpacing(QFont::AbsoluteSpacing, 0.88); rl->setFont(f); } rl->setContentsMargins(8, 4, 8, 8); d->rail->addWidget(rl);
    d->limItem = new QueueItem("Data cap", QColor("#ff8b8b"), railW); connect(d->limItem, &QAbstractButton::clicked, this, [this] { d->show("limits"); });
    d->rail->addWidget(d->limItem); d->rail->addStretch(1);
    auto* ra = new QWidget; auto* rah = hbox(ra, 6); auto* nw = new PushButton(PushButton::Secondary, "New queue"); d->delBtn = new PushButton(PushButton::Secondary, "Delete");
    nw->metrics(8, 7, 4, 500); d->delBtn->metrics(8, 7, 4, 500); nw->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed); d->delBtn->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
    rah->addWidget(nw, 1); rah->addWidget(d->delBtn, 1); d->rail->addWidget(ra);
    d->nameForm = new QWidget; auto* nh = hbox(d->nameForm, 6, QMargins(0, 8, 0, 0)); d->nameInput = new QLineEdit; d->nameInput->setProperty("v", "studio"); d->nameInput->setMaxLength(40); d->nameInput->setPlaceholderText("Queue name");
    auto* addB = new PushButton(PushButton::Primary, "Add"); nh->addWidget(d->nameInput, 1); nh->addWidget(addB); d->nameForm->hide(); d->rail->addWidget(d->nameForm);
    rh->addWidget(railW);
    auto* main = new QWidget; auto* mv = vbox(main, 0);
    auto* head = new QWidget; auto* hv = vbox(head, 10, QMargins(18, 14, 18, 0));
    d->heading = makeLabel("General queue", 16, 650, "t1"); hv->addWidget(d->heading);
    d->tabsBox = new QWidget; { QSizePolicy sp = d->tabsBox->sizePolicy(); sp.setRetainSizeWhenHidden(true); d->tabsBox->setSizePolicy(sp); }
    auto* tbh = hbox(d->tabsBox, 6);
    d->tabs[0] = new Pill("Schedule", d->tabsBox); d->tabs[1] = new Pill("Files in the queue", d->tabsBox); tbh->addWidget(d->tabs[0]); tbh->addWidget(d->tabs[1]); tbh->addStretch(1); hv->addWidget(d->tabsBox);
    mv->addWidget(head);
    d->scroll = new QScrollArea; d->scroll->setWidgetResizable(true); d->scroll->setFrameShape(QFrame::NoFrame); d->scroll->viewport()->setAutoFillBackground(false); d->scroll->viewport()->setStyleSheet("background: transparent;");
    d->paneHost = new QWidget; d->paneHost->setStyleSheet("background: transparent;"); d->scroll->setWidget(d->paneHost); mv->addWidget(d->scroll, 1);
    d->help = new QLabel("Start now runs every paused, failed, or waiting file. Stop pauses what is downloading. A checked time runs only while ZDM is open. Apply stores the queues and the download cap.");
    d->help->setWordWrap(true); d->help->setFont(Theme::uiFont(12)); d->help->setContentsMargins(14, 12, 14, 12); d->help->hide(); d->help->setProperty("c", "t2");
    struct HelpCard : QFrame { void paintEvent(QPaintEvent*) override { QPainter p(this); p.setRenderHint(QPainter::Antialiasing); QPainterPath pp; pp.addRoundedRect(QRectF(rect()), 12, 12); p.fillPath(pp, Theme::I().t().glow); } };
    auto* hc = new HelpCard; auto* hcl = vbox(hc, 0); hcl->addWidget(d->help); hc->hide(); mv->addWidget(hc);
    rh->addWidget(main, 1); col->addWidget(row, 1);
    // footer
    col->addWidget(hsep("1"));
    auto* ft = new QWidget; auto* fh = hbox(ft, 8, QMargins(16, 12, 16, 12));
    d->start = new PushButton(PushButton::Primary, "Start now"); d->stop = new PushButton(PushButton::Secondary, "Stop");
    auto* helpB = new PushButton(PushButton::Secondary, "Help"); d->apply = new PushButton(PushButton::Secondary, "Apply"); auto* closeB = new PushButton(PushButton::Secondary, "Close");
    fh->addWidget(d->start); fh->addWidget(d->stop); fh->addStretch(1); fh->addWidget(helpB); fh->addWidget(d->apply); fh->addWidget(closeB); col->addWidget(ft);

    connect(d->tabs[0], &QAbstractButton::clicked, this, [this] { d->readPane(); d->q->tab = "schedule"; d->paintPane(); });
    connect(d->tabs[1], &QAbstractButton::clicked, this, [this] { d->readPane(); d->q->tab = "files"; d->paintPane(); });
    connect(nw, &QAbstractButton::clicked, this, [this] { d->nameForm->show(); d->nameInput->setFocus(); });
    connect(addB, &QAbstractButton::clicked, this, [this] { const QString n = d->nameInput->text().trimmed(); if (n.isEmpty()) return; Queue& nq = d->q->createQueue(n); const QString id = nq.id; d->nameInput->clear(); d->nameForm->hide(); d->rebuildRail(); d->show(id); });
    connect(d->nameInput, &QLineEdit::returnPressed, addB, &QAbstractButton::click);
    connect(d->delBtn, &QAbstractButton::clicked, this, [this] { Queue* c = d->q->byId(d->q->activeId); if (!c || c->kind != "custom") return; d->q->deleteQueue(c->id); d->rebuildRail(); d->show("main"); });
    connect(d->start, &QAbstractButton::clicked, this, [this] { d->q->startNow(d->q->activeId == "limits" ? "main" : d->q->activeId); });
    connect(d->stop, &QAbstractButton::clicked, this, [this] { d->q->stopNow(d->q->activeId == "limits" ? "main" : d->q->activeId); });
    connect(helpB, &QAbstractButton::clicked, this, [hc] { hc->setVisible(!hc->isVisible()); hc->findChild<QLabel*>()->show(); });
    connect(d->apply, &QAbstractButton::clicked, this, [this] { d->save(); });
    connect(closeB, &QAbstractButton::clicked, this, [this] { d->readPane(); close(); });
    connect(q, &QueueEngine::changed, this, [this] { d->paintActions(); if (d->q->tab == "files" && d->ftable) d->ftable->reload(); });
    connect(s, &Store::rowChanged, this, [this] { if (d->ftable) d->ftable->update(); d->paintActions(); });
    connect(s, &Store::listChanged, this, [this] { d->paintActions(); if (d->ftable) d->ftable->reload(); });
    d->rebuildRail(); d->paintQueues(); d->paintPane(); d->paintActions();
}

void SchedulerDialog::navigate(const QString& queueId, const QString& tab) {
    d->readPane();
    if (!queueId.isEmpty()) d->q->activeId = queueId;
    if (tab == "files" || tab == "schedule") d->q->tab = tab;
    d->rebuildRail(); d->paintQueues(); d->paintPane(); d->paintActions();
}
