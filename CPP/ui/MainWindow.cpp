#include "MainWindow.h"
#include <algorithm>
#include <cmath>

// =================================================================== toolbar widgets
class ToolBtn : public QAbstractButton {
public:
    ToolBtn(const QString& icon, const QString& text, QWidget* p = nullptr) : QAbstractButton(p), m_icon(icon) {
        setText(text); setAttribute(Qt::WA_Hover); setCursor(Qt::PointingHandCursor); setFocusPolicy(Qt::NoFocus);
        setFont(Theme::uiFont(11));
        connect(&Theme::I(), &Theme::changed, this, [this] { update(); });
    }
    QSize sizeHint() const override {
        const QFontMetrics fm(font());
        return {qMax(fm.horizontalAdvance(text()), 26) + 24, 4 + 26 + 2 + fm.lineSpacing() + 4};
    }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t();
        QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        const bool hov = underMouse() && isEnabled();
        if (isDown() && isEnabled()) { p.translate(width() / 2.0, height() / 2.0); p.scale(.96, .96); p.translate(-width() / 2.0, -height() / 2.0); }
        if (hov) { QPainterPath pp; pp.addRoundedRect(QRectF(rect()), 4, 4); p.fillPath(pp, t.glow); }
        if (m_icon.contains('/')) {
            const qreal dpr = p.device()->devicePixelRatio();
            QPixmap pm(Theme::assetPath(m_icon));
            if (!pm.isNull()) pm = pm.scaled(QSize(26, 26) * dpr, Qt::KeepAspectRatio, Qt::SmoothTransformation);
            pm.setDevicePixelRatio(dpr);
            drawPm(p, pm, QRectF(0, 4, width(), 26));
        } else {
            drawPm(p, Theme::I().icon(m_icon, Use::Toolbar, 26, !isEnabled()), QRectF(0, 4, width(), 26));
        }
        p.setFont(font()); p.setPen(!isEnabled() ? t.muted : hov ? t.accent : t.t2);
        const QFontMetrics fm(font());
        p.drawText(QRect(0, 4 + 26 + 2, width(), fm.lineSpacing()), Qt::AlignHCenter | Qt::AlignVCenter, text());
    }
private:
    QString m_icon;
};
class CaretBtn : public QAbstractButton {
public:
    CaretBtn(QWidget* p = nullptr) : QAbstractButton(p) { setAttribute(Qt::WA_Hover); setFixedWidth(22); setCursor(Qt::PointingHandCursor); setFocusPolicy(Qt::NoFocus); }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t();
        QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        const bool hov = underMouse();
        if (hov) { QPainterPath pp; pp.addRoundedRect(QRectF(rect()), 4, 4); p.fillPath(pp, t.glow); }
        p.setFont(Theme::uiFont(16)); p.setPen(hov ? t.accent : t.t2);
        p.drawText(rect(), Qt::AlignCenter, QString::fromUtf8("\xE2\x96\xBE"));
    }
};
class ToolbarBar : public QWidget {
public:
    ToolbarBar(QWidget* p = nullptr) : QWidget(p) { setFixedHeight(64); connect(&Theme::I(), &Theme::changed, this, [this] { update(); }); }
protected:
    void paintEvent(QPaintEvent*) override {
        QPainter p(this); const Tokens& t = Theme::I().t();
        p.fillRect(rect(), t.bg2); p.fillRect(QRect(0, height() - 1, width(), 1), t.border);
    }
};
class SepV : public QWidget {                 // .toolbar-sep 1x32, margin 0 4px
public:
    SepV(QWidget* p = nullptr) : QWidget(p) { setFixedSize(1, 32); }
protected:
    void paintEvent(QPaintEvent*) override { QPainter p(this); p.fillRect(rect(), Theme::I().t().border); }
};

// =================================================================== sidebar
class SideRow : public QWidget {
    Q_OBJECT
public:
    enum Kind { Group, Child, Playlist };
    SideRow(Kind k, const QString& cat, const QString& label, const QString& icon, QWidget* p = nullptr)
        : QWidget(p), cat(cat), label(label), icon(icon), kind(k) {
        setAttribute(Qt::WA_Hover); setCursor(Qt::PointingHandCursor);
        connect(&Theme::I(), &Theme::changed, this, [this] { update(); });
    }
    QString cat, label, icon, url; Kind kind; bool caret = false, collapsed = false, active = false; int badge = -1, num = 0;
    QSize sizeHint() const override {
        const int ls = QFontMetrics(Theme::uiFont(12)).lineSpacing();
        if (kind == Group) return {100, 6 + qMax(24, ls) + 6};
        if (kind == Child) return {100, 5 + qMax(24, ls) + 5};
        return {100, 5 + qMax(16, ls) + 5};
    }
signals:
    void activated(const QString& cat);
    void caretToggled(const QString& cat);
    void playlistOpen(const QString& url);
    void contextRequested(const QString& cat, const QPoint& g);
protected:
    void contextMenuEvent(QContextMenuEvent* e) override { emit contextRequested(cat, e->globalPos()); }
    void mouseReleaseEvent(QMouseEvent* e) override {
        if (e->button() != Qt::LeftButton) return;
        if (kind == Group && caret && e->pos().x() >= 4 && e->pos().x() < 24) { emit caretToggled(cat); return; }
        if (kind == Playlist && e->pos().x() >= 6 && e->pos().x() < 22) { emit playlistOpen(url); return; }
        emit activated(cat);
    }
    void paintEvent(QPaintEvent*) override {
        const Theme& th = Theme::I(); const Tokens& t = th.t();
        QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        const QRectF r(rect());
        if (active) th.paintNavActive(&p, r, 4);
        else if (underMouse()) { QPainterPath pp; pp.addRoundedRect(r, 4, 4); p.fillPath(pp, t.hover); }
        const QColor fg = active ? t.navFg : underMouse() ? t.t1 : t.t2;
        int x = kind == Playlist ? 6 : 8;
        const int cy = height() / 2;
        if (kind == Group && caret) {
            const qreal cx = x + 7.0;
            const qreal cyf = height() / 2.0;
            p.setPen(Qt::NoPen);
            p.setBrush(fg);
            if (collapsed) {
                p.drawPolygon(QPolygonF({ QPointF(cx - 2.5, cyf - 4.0), QPointF(cx + 3.5, cyf), QPointF(cx - 2.5, cyf + 4.0) }));
            } else {
                p.drawPolygon(QPolygonF({ QPointF(cx - 4.0, cyf - 2.5), QPointF(cx + 4.0, cyf - 2.5), QPointF(cx, cyf + 3.5) }));
            }
            x += 14 + 6;
        }
        if (kind == Playlist) {
            p.setPen(QPen(fg, 1.4, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin));              // download glyph 12px
            const QPointF c(x + 8, cy);
            p.drawLine(c + QPointF(0, -4), c + QPointF(0, 1.5));
            p.drawPolyline(QPolygonF({c + QPointF(-3, -1), c + QPointF(0, 2), c + QPointF(3, -1)}));
            p.drawLine(c + QPointF(-5, 5), c + QPointF(5, 5));
            x += 16 + 4;
            const QRectF g(x, cy - 7, 12, 14);                              // .file-glyph
            p.setPen(QPen(fg, 1.5)); p.setBrush(Qt::NoBrush); p.drawRoundedRect(g.adjusted(.75, .75, -.75, -.75), 2, 2);
            p.setPen(Qt::NoPen);                                            // ::after { border-top: 5px card; border-left: 5px currentColor }
            p.setBrush(t.card); p.drawPolygon(QPolygonF({{g.right() - 4, g.top() - 1}, {g.right() + 1, g.top() - 1}, {g.right() + 1, g.top() + 4}}));
            p.setBrush(fg);     p.drawPolygon(QPolygonF({{g.right() - 4, g.top() - 1}, {g.right() + 1, g.top() + 4}, {g.right() - 4, g.top() + 4}}));
            x += 12 + 6 + 4;
        } else if (num > 0) {
            const QSize s = queueNumSize(num);
            paintQueueNum(p, QPointF(x + s.width() / 2.0, cy), num, active ? Use::TreeOn : Use::TreeOff);
            x += s.width() + 6;
        } else {
            drawPm(p, th.icon(icon, active ? Use::TreeOn : Use::TreeOff, 24), QRectF(x, cy - 12, 24, 24));
            x += 24 + 6;
        }
        int right = width() - 8;
        if (badge >= 0) {
            const QFont f = Theme::uiFont(11); const QString s = QString::number(badge);
            const int bw = QFontMetrics(f).horizontalAdvance(s) + 12;
            p.setFont(f); p.setPen(active ? t.t1 : t.muted);
            p.drawText(QRect(right - bw, 0, bw, height()), Qt::AlignCenter, s);
            right -= bw + 6;
        }
        const QFont f = Theme::uiFont(12);
        p.setFont(f); p.setPen(fg);
        p.drawText(QRect(x, 0, right - x, height()), Qt::AlignVCenter | Qt::AlignLeft, QFontMetrics(f).elidedText(label, Qt::ElideRight, right - x));
    }
};

class Grip : public QWidget {                    // .sidebar-resizer 5px
public:
    Grip(QWidget* side) : QWidget(side), m_side(side) { setCursor(Qt::SplitHCursor); setAttribute(Qt::WA_Hover); }
protected:
    void paintEvent(QPaintEvent*) override { if (underMouse() || m_drag) QPainter(this).fillRect(rect(), Theme::I().t().accent); }
    void mousePressEvent(QMouseEvent* e) override { m_drag = true; m_x = e->globalPosition().x(); m_w = m_side->width(); update(); }
    void mouseMoveEvent(QMouseEvent* e) override { if (m_drag) m_side->setFixedWidth(qBound(160, int(m_w + e->globalPosition().x() - m_x), 420)); }
    void mouseReleaseEvent(QMouseEvent*) override { m_drag = false; update(); }
private:
    QWidget* m_side; bool m_drag = false; qreal m_x = 0; int m_w = 200;
};

class Sidebar : public QWidget {
    Q_OBJECT
public:
    Sidebar(QWidget* p = nullptr) : QWidget(p) {
        setFixedWidth(200);
        auto* v = vbox(this, 0, QMargins(0, 8, 0, 8));
        auto* hdr = makeLabel("Categories", 12, 600, "muted"); hdr->setContentsMargins(16, 8, 16, 8);
        v->addWidget(hdr); v->addSpacing(4);
        m_scroll = new QScrollArea; m_scroll->setWidgetResizable(true); m_scroll->setFrameShape(QFrame::NoFrame);
        m_scroll->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
        m_scroll->viewport()->setAutoFillBackground(false);
        m_scroll->viewport()->setStyleSheet("background: transparent;");
        auto* tree = new QWidget; tree->setAutoFillBackground(false); tree->setStyleSheet("background: transparent;");
        m_tree = vbox(tree, 2, QMargins(8, 4, 8, 4)); m_tree->setAlignment(Qt::AlignTop);
        m_scroll->setWidget(tree);
        v->addWidget(m_scroll, 1);
        m_grip = new Grip(this);
        connect(&Theme::I(), &Theme::changed, this, [this] { update(); });

        const char* sub[5][3] = {{"compressed", "Compressed", "compress.png"}, {"documents", "Documents", "documents.png"}, {"music", "Sounds", "music.png"},
                                 {"programs", "Programs", "programs.png"}, {"video", "Video", "video.png"}};
        struct G { const char* cat; const char* label; const char* icon; bool open; } gs[3] = {
            {"all", "All Downloads", "all-downloads.png", true}, {"unfinished", "Unfinished", "unfinished.png", false}, {"finished", "Finished", "finished.png", false}};
        for (const G& g : gs) {
            auto* grp = addGroup(g.cat, g.label, g.icon, g.open);
            for (auto& s : sub) addChild(grp, QString(g.cat) + "_" + s[0], s[1], s[2]);
        }
        m_queues = addGroup("queues", "Queues", "queues.png", false);
        addChild(m_queues, "queue_main", "General queue", "main-queues.png");
        addChild(m_queues, "queue_sync", "Repeat queue", "sync.png");
        m_plays = addGroup("playlists", "Playlists", "add-playlist.png", false);
        m_plays->kidsLayout->setContentsMargins(8, 2, 0, 0);          // #playlist-tree { padding-left: 8px }
        setActive("all");
    }
    struct Grp { SideRow* head; QWidget* kids; QVBoxLayout* kidsLayout; };
    void setActive(const QString& cat) { m_active = cat; for (SideRow* r : m_rows) { r->active = (r->cat == cat); r->update(); } }
    void setBadge(int n) { if (m_rows.value(0)) { m_rows[0]->badge = n; m_rows[0]->update(); } }
    void rebuildQueues(QueueEngine* q) {
        for (SideRow* r : m_customQ) { m_rows.removeAll(r); r->deleteLater(); }
        m_customQ.clear();
        for (const Queue& qu : q->queues) if (qu.kind == "custom") {
            auto* r = addChild(m_queues, "queue_" + qu.id, qu.name, QString());
            r->num = q->customIndex(qu.id); r->active = (m_active == r->cat); m_customQ << r;
        }
    }
    void rebuildPlaylists(const QVector<QJsonObject>& list) {
        for (SideRow* r : m_playRows) { m_rows.removeAll(r); r->deleteLater(); }
        m_playRows.clear();
        for (const auto& it : list) {
            auto* r = new SideRow(SideRow::Playlist, "playlist_" + it.value("url").toString(), it.value("name").toString("Playlist"), QString(), m_plays->kids);
            r->url = it.value("url").toString(); r->active = (m_active == r->cat);
            r->setToolTip(r->label);
            m_plays->kidsLayout->addWidget(r); m_rows << r; m_playRows << r;
            connect(r, &SideRow::activated, this, &Sidebar::choose);
            connect(r, &SideRow::playlistOpen, this, &Sidebar::playlistOpen);
            connect(r, &SideRow::contextRequested, this, &Sidebar::contextRequested);
        }
    }
signals:
    void categoryChosen(const QString& cat);
    void contextRequested(const QString& cat, const QPoint& g);
    void playlistOpen(const QString& url);
protected:
    void resizeEvent(QResizeEvent*) override { m_grip->setGeometry(width() - 1 - 5, 0, 5, height()); }
    void paintEvent(QPaintEvent*) override {
        QPainter p(this); const Tokens& t = Theme::I().t();
        p.fillRect(rect(), t.bg2); p.fillRect(QRect(width() - 1, 0, 1, height()), t.border);
    }
private:
    void choose(const QString& cat) {
        if (cat == "playlists" && m_plays->head->collapsed) toggle(m_plays, false);
        setActive(cat); emit categoryChosen(cat);
    }
    void toggle(Grp* g, bool collapsed) { g->head->collapsed = collapsed; g->kids->setVisible(!collapsed); g->head->update(); }
    Grp* addGroup(const QString& cat, const QString& label, const QString& icon, bool open) {
        auto* g = new Grp; auto* blk = new QWidget; auto* bl = vbox(blk, 0);
        g->head = new SideRow(SideRow::Group, cat, label, icon, blk); g->head->caret = true; g->head->collapsed = !open;
        g->kids = new QWidget(blk); g->kidsLayout = vbox(g->kids, 2, QMargins(24, 2, 0, 0));
        g->kids->setVisible(open);
        bl->addWidget(g->head); bl->addWidget(g->kids);
        m_tree->addWidget(blk); m_rows << g->head;
        connect(g->head, &SideRow::activated, this, &Sidebar::choose);
        connect(g->head, &SideRow::caretToggled, this, [this, g] { toggle(g, !g->head->collapsed); });
        connect(g->head, &SideRow::contextRequested, this, &Sidebar::contextRequested);
        return g;
    }
    SideRow* addChild(Grp* g, const QString& cat, const QString& label, const QString& icon) {
        auto* r = new SideRow(SideRow::Child, cat, label, icon, g->kids);
        g->kidsLayout->addWidget(r); m_rows << r;
        connect(r, &SideRow::activated, this, &Sidebar::choose);
        connect(r, &SideRow::contextRequested, this, &Sidebar::contextRequested);
        return r;
    }
    QScrollArea* m_scroll; QVBoxLayout* m_tree; Grip* m_grip; Grp *m_queues, *m_plays;
    QVector<SideRow*> m_rows, m_customQ, m_playRows; QString m_active;
};

// =================================================================== helpers (app.js)
static const QHash<QString, QString> kExt = {
    {"mp4", "video"}, {"mkv", "video"}, {"avi", "video"}, {"mov", "video"}, {"webm", "video"}, {"flv", "video"},
    {"mp3", "music"}, {"flac", "music"}, {"wav", "music"}, {"aac", "music"}, {"ogg", "music"},
    {"zip", "archive"}, {"rar", "archive"}, {"7z", "archive"}, {"tar", "archive"}, {"gz", "archive"},
    {"pdf", "document"}, {"doc", "document"}, {"docx", "document"}, {"txt", "document"}, {"xls", "document"},
    {"exe", "program"}, {"msi", "program"}, {"dmg", "program"},
    {"jpg", "image"}, {"jpeg", "image"}, {"png", "image"}, {"gif", "image"}, {"webp", "image"}, {"svg", "image"}};
static QString fileType(const QString& name) { return kExt.value(name.section('.', -1).toLower(), "other"); }
static QString playlistKey(const QString& url) {
    const QString s = url.trimmed();
    static const QRegularExpression re("[?&]list=([a-zA-Z0-9_-]+)");
    const auto m = re.match(s);
    if (m.hasMatch()) return "yt:" + m.captured(1);
    QString t = s.section('#', 0, 0); while (t.endsWith('/')) t.chop(1);
    return t;
}
static bool isActiveSt(const QString& s) { return s == "downloading" || s == "merging"; }
static bool isStartable(const QString& s) { return s == "paused" || s == "error" || s == "queued"; }

// =================================================================== MainWindow
static TitleSpec mainSpec() { TitleSpec s; s.h = 32; s.caption = "Zetta Download Manager"; s.app = true; s.border = false; s.buttons = 7; s.winBg = TitleSpec::Sec; return s; }

MainWindow::MainWindow(Store* s, QueueEngine* q) : FramelessWindow(mainSpec(), true, false), m_s(s), m_q(q) {
    setWindowTitle("Zetta Download Manager");
    resize(1180, 680); setMinimumSize(1140, 560);
    auto* v = vbox(body());

    // ---- toolbar
    auto* bar = new ToolbarBar; v->addWidget(bar);
    auto* h = hbox(bar, 4, QMargins(8, 0, 8, 0));
    auto add = [&](const QString& key, const QString& icon, const QString& text, bool enabled) {
        auto* b = new ToolBtn(icon, text); b->setEnabled(enabled); m_btn[key] = b; h->addWidget(b, 0, Qt::AlignVCenter); return b;
    };
    auto sep = [&] { h->addSpacing(4); h->addWidget(new SepV, 0, Qt::AlignVCenter); h->addSpacing(4); };
    auto split = [&](const QString& key, const QString& icon, const QString& text, bool start) {
        auto* w = new QWidget; auto* sh = hbox(w, -4);
        auto* b = new ToolBtn(icon, text); b->setEnabled(false); m_btn[key] = b;
        auto* c = new CaretBtn; sh->addWidget(b); sh->addWidget(c);
        h->addWidget(w, 0, Qt::AlignVCenter);
        connect(c, &QAbstractButton::clicked, this, [this, w, start] { openQueueMenu(w, start); });
    };
    connect(add("add-url", "add-url.png", "Add URL", true), &QAbstractButton::clicked, this, [this] { m_s->bridge()->send("window:open-address-dialog"); });
    connect(add("playlist", "add-playlist.png", "Playlist", true), &QAbstractButton::clicked, this, [this] { m_s->bridge()->send("window:open-playlist"); });
    connect(add("resume", "resume.png", "Resume", false), &QAbstractButton::clicked, this, [this] {
        for (const auto& d : selected()) if (isStartable(d.value("status").toString())) { m_s->setStatusQuiet(d.value("id").toString(), "downloading"); m_s->bridge()->send("download:resume", d.value("id").toString()); }
        updateToolbar();
    });
    connect(add("stop", "stop.png", "Stop", false), &QAbstractButton::clicked, this, [this] {
        for (const auto& d : selected()) if (isActiveSt(d.value("status").toString())) { m_s->setStatusQuiet(d.value("id").toString(), "paused"); m_s->bridge()->send("download:pause", d.value("id").toString()); }
        updateToolbar();
    });
    connect(add("stop-all", "stop-all.png", "Stop All", false), &QAbstractButton::clicked, this, [this] {
        m_q->stopAll();
        for (const auto& d : QVector<QJsonObject>(m_s->list())) if (isActiveSt(d.value("status").toString())) { m_s->setStatusQuiet(d.value("id").toString(), "paused"); m_s->bridge()->send("download:pause", d.value("id").toString()); }
        updateToolbar();
    });
    sep();
    connect(add("delete", "delete.png", "Delete", false), &QAbstractButton::clicked, this, [this] { openDeleteMenu(); });
    connect(add("open-folder", "open-folder.png", "Open Folder", false), &QAbstractButton::clicked, this, [this] {
        const auto sel = selected(); if (sel.size() != 1) return;
        if (sel[0].value("status").toString() == "complete" && !sel[0].value("path").toString().isEmpty()) m_s->bridge()->send("download:open-folder", sel[0].value("path"));
    });
    sep();
    connect(add("options", "options.png", "Options", true), &QAbstractButton::clicked, this, [this] { m_s->bridge()->send("window:open-settings"); });
    connect(add("scheduler", "scheduler.png", "Scheduler", true), &QAbstractButton::clicked, this, [this] { m_s->bridge()->send("window:open-scheduler", QJsonObject{}); });
    split("start-queue", "start-queue.png", "Start Queue", true);
    split("stop-queue", "stop-queue.png", "Stop Queue", false);
    connect(add("extension", "icons/app.png", "Install Extension", true), &QAbstractButton::clicked, this, [this] { m_s->bridge()->send("window:open-extension-setup"); });
    h->addStretch(1);
    auto queueIdOfCategory = [this] { return m_cat.startsWith("queue_") ? m_cat.mid(6) : QString("main"); };
    connect(m_btn["start-queue"], &QAbstractButton::clicked, this, [this, queueIdOfCategory] { m_q->startNow(queueIdOfCategory()); });
    connect(m_btn["stop-queue"], &QAbstractButton::clicked, this, [this, queueIdOfCategory] { m_q->stopNow(queueIdOfCategory()); });

    // ---- body
    auto* row = new QWidget; auto* rh = hbox(row);
    m_side = new Sidebar; rh->addWidget(m_side);
    m_list = new DownloadList(s, q); rh->addWidget(m_list, 1);
    v->addWidget(row, 1);

    connect(m_side, &Sidebar::categoryChosen, this, [this](const QString& c) { m_cat = c; refresh(); });
    connect(m_side, &Sidebar::playlistOpen, this, [this](const QString& u) { m_s->bridge()->send("window:open-playlist", u); });
    connect(m_side, &Sidebar::contextRequested, this, [this](const QString& cat, const QPoint& g) {
        auto* m = makeMenu(this); m->setAttribute(Qt::WA_DeleteOnClose);
        if (cat == "queues" || cat.startsWith("queue_")) {
            const QString qid = cat == "queues" ? "main" : cat.mid(6);
            const Queue* qu = m_q->byId(qid);
            const auto files = m_q->filesFor(qu ? *qu : m_q->queues[0]);
            bool canStart = false, canStop = false;
            for (const auto& d : files) { canStart |= isStartable(d.value("status").toString()); canStop |= d.value("status").toString() == "downloading"; }
            m->addAction("Start now", this, [this, qid] { m_q->startNow(qid); })->setEnabled(canStart);
            m->addAction("Stop", this, [this, qid] { m_q->stopNow(qid); })->setEnabled(canStop);
            m->addSeparator();
            m->addAction("Edit queue", this, [this, qid] { m_s->bridge()->send("window:open-scheduler", QJsonObject{{"queueId", qid}, {"tab", "files"}}); });
            m->addAction("Schedule", this, [this, qid] { m_s->bridge()->send("window:open-scheduler", QJsonObject{{"queueId", qid}, {"tab", "schedule"}}); });
            m->addSeparator();
            m->addAction("Delete", this, [this, qid] { m_q->deleteQueue(qid); })->setEnabled(qu && qu->kind == "custom");
            m->addAction("Create new queue", this, [this] { bool ok; const QString n = QInputDialog::getText(this, "Queue name", "Queue name", QLineEdit::Normal, "", &ok); if (ok && !n.trimmed().isEmpty()) m_q->createQueue(n.trimmed()); });
        } else if (cat.startsWith("playlist_")) {
            const QString url = cat.mid(9);
            m->addAction("Open in playlist dialog", this, [this, url] { m_s->bridge()->send("window:open-playlist", url); });
            m->addAction("Copy playlist address", this, [url] { QApplication::clipboard()->setText(url); });
            m->addSeparator();
            m->addAction("Remove playlist", this, [this, url] { m_s->bridge()->invoke("playlist:remove", url); });
        } else { delete m; return; }
        m->popup(g);
    });
    connect(m_list, &DownloadList::sortClicked, this, &MainWindow::onSort);
    connect(m_list, &DownloadList::rowClicked, this, &MainWindow::onRowClicked);
    connect(m_list, &DownloadList::contextRequested, this, &MainWindow::onContext);
    connect(m_list, &DownloadList::blankClicked, this, [this] { m_list->selection().clear(); m_lastSel.clear(); m_list->viewport()->update(); updateToolbar(); });
    connect(m_list, &DownloadList::rowDoubleClicked, this, [this](const QString& id) {
        const QJsonObject* d = m_s->find(id); if (!d) return;
        if (d->value("status").toString() == "complete" && !d->value("path").toString().isEmpty()) m_s->bridge()->send("download:open-file", d->value("path"));
        else m_s->bridge()->send("progress:open", id);
    });
    connect(m_s, &Store::listChanged, this, [this] { refresh(); });
    connect(m_s, &Store::rowChanged, this, [this](const QString& id) { m_list->repaintRow(id); updateToolbar(); });
    connect(m_q, &QueueEngine::changed, this, [this] { m_side->rebuildQueues(m_q); m_list->viewport()->update(); updateToolbar(); });
    connect(&Theme::I(), &Theme::changed, this, [this] { m_list->viewport()->update(); });
    connect(m_s->bridge(), &Bridge::event, this, [this](const QString& ch, const QJsonValue&) {
        if (ch == "playlists:changed") {
            m_playlists.clear(); for (const auto& x : m_s->bridge()->invoke("playlist:saved").toArray()) m_playlists << x.toObject();
            m_side->rebuildPlaylists(m_playlists);
        } else if (ch == "queue:start-all") {
            for (const auto& d : QVector<QJsonObject>(m_s->list())) if (isStartable(d.value("status").toString())) { m_s->setStatusQuiet(d.value("id").toString(), "downloading"); m_s->bridge()->send("download:resume", d.value("id").toString()); }
            updateToolbar();
        } else if (ch == "queue:stop-all") {
            m_q->stopAll();
            for (const auto& d : QVector<QJsonObject>(m_s->list())) if (isActiveSt(d.value("status").toString())) { m_s->setStatusQuiet(d.value("id").toString(), "paused"); m_s->bridge()->send("download:pause", d.value("id").toString()); }
            updateToolbar();
        }
    });
    auto* sc = new QShortcut(QKeySequence("Ctrl+A"), this);
    connect(sc, &QShortcut::activated, this, [this] { if (!qobject_cast<QLineEdit*>(QApplication::focusWidget())) selectAll(); });

    for (const auto& x : m_s->bridge()->invoke("playlist:saved").toArray()) m_playlists << x.toObject();
    m_side->rebuildPlaylists(m_playlists);
    m_side->rebuildQueues(m_q);
    applySavedSort();
    refresh();
    setupTray();
}

void MainWindow::setupTray() {
    QIcon icon(Theme::assetPath("icons/tray.png"));
    if (icon.isNull()) icon = windowIcon();
    m_tray = new QSystemTrayIcon(icon, this);
    m_tray->setToolTip("Zetta Download Manager");
    auto* menu = new QMenu;                               // no window parent: the menu must open while the window is hidden
    menu->addAction("Show", this, [this] { showFromTray(); });
    auto* start = menu->addMenu("Start queue");
    connect(start, &QMenu::aboutToShow, this, [this, start] {
        start->clear();
        const QVector<Queue> queues = m_q->queues;
        for (const Queue& q : queues) {
            const QString id = q.id;
            const QString name = q.name.trimmed().isEmpty() ? QString("Queue") : q.name.trimmed();
            start->addAction(name, this, [this, id] { m_q->startNow(id); });
        }
        start->addSeparator();
        start->addAction("All queues", this, [this] {
            const QVector<Queue> all = m_q->queues;
            for (const Queue& q : all) m_q->startNow(q.id);
        });
    });
    menu->addSeparator();
    menu->addAction("Exit", this, [this] { quitApp(); });
    m_tray->setContextMenu(menu);
    connect(m_tray, &QSystemTrayIcon::activated, this, [this](QSystemTrayIcon::ActivationReason reason) {
        if (reason == QSystemTrayIcon::Trigger || reason == QSystemTrayIcon::DoubleClick) showFromTray();
    });
    m_tray->show();
}

void MainWindow::showFromTray() {
    if (isMinimized()) showNormal();
    show();
    raise();
    activateWindow();
}

void MainWindow::quitApp() {
    m_allowQuit = true;
    qApp->setProperty("zdm_quit", true);
    qApp->quit();
}

void MainWindow::closeEvent(QCloseEvent* e) {
    if (qApp->property("zdm_quit").toBool()) m_allowQuit = true;
    if (!m_allowQuit && m_tray && m_tray->isVisible()) {
        e->ignore();
        hide();
        return;
    }
    m_allowQuit = true;
    e->accept();
    if (!qApp->property("zdm_quit").toBool()) {
        qApp->setProperty("zdm_quit", true);
        qApp->quit();
    }
}

void MainWindow::applySavedSort() {
    static const QStringList ok = {"fileName", "size", "status", "speed", "time", "tried", "progress"};
    const QJsonObject l = m_s->settings().value("list").toObject();
    const QString c = l.value("sortCol").toString();
    if (ok.contains(c)) { m_sortCol = c; m_sortAsc = l.value("sortAsc").toBool(true); m_list->setSort(m_sortCol, m_sortAsc); }
}

bool MainWindow::isPlaylistDownload(const QJsonObject& item, const QString& url) const {
    const QString ipk = playlistKey(item.value("playlistUrl").toString()), isk = playlistKey(item.value("sourcePage").toString());
    if (!url.isEmpty()) {
        const QString tk = playlistKey(url);
        if (!tk.isEmpty()) { if (!ipk.isEmpty() && ipk == tk) return true; if (!isk.isEmpty() && isk == tk) return true; }
        return false;
    }
    if (!item.value("playlistUrl").toString().isEmpty()) return true;
    QSet<QString> keys; for (const auto& p : m_playlists) { const QString k = playlistKey(p.value("url").toString()); if (!k.isEmpty()) keys.insert(k); }
    return (!ipk.isEmpty() && keys.contains(ipk)) || (!isk.isEmpty() && keys.contains(isk));
}

QVector<QJsonObject> MainWindow::filtered() const {
    const auto& all = m_s->list();
    QVector<QJsonObject> out;
    const QString cat = m_cat;
    if (cat == "all") return all;
    if (cat == "queues") { for (const auto& d : all) if (m_q->queueOf(d.value("id").toString())) out << d; return out; }
    if (cat.startsWith("queue_")) { for (const auto& d : all) { const Queue* qq = m_q->queueOf(d.value("id").toString()); if (qq && qq->id == cat.mid(6)) out << d; } return out; }
    if (cat == "playlists") { for (const auto& d : all) if (isPlaylistDownload(d, QString())) out << d; return out; }
    if (cat.startsWith("playlist_")) { for (const auto& d : all) if (isPlaylistDownload(d, cat.mid(9))) out << d; return out; }
    if (cat.isEmpty() || cat == "grabber") return out;
    QVector<QJsonObject> target = all;
    if (cat.startsWith("unfinished")) { target.clear(); for (const auto& d : all) if (d.value("status").toString() != "complete") target << d; }
    else if (cat.startsWith("finished")) { target.clear(); for (const auto& d : all) if (d.value("status").toString() == "complete") target << d; }
    const QString sub = cat.section('_', 1, 1);
    if (sub.isEmpty()) return target;
    static const QHash<QString, QString> map = {{"compressed", "archive"}, {"documents", "document"}, {"programs", "program"}, {"images", "image"}};
    const QString want = map.value(sub, sub);
    for (const auto& d : target) if (fileType(d.value("fileName").toString()) == want) out << d;
    return out;
}

void MainWindow::refresh() {
    QVector<QJsonObject> rows = filtered();
    if (!m_sortCol.isEmpty()) {
        auto key = [&](const QJsonObject& d, QString& s, double& n) {
            const QJsonObject pr = d.value("progress").toObject();
            if (m_sortCol == "fileName") s = d.value("fileName").toString().toLower();
            else if (m_sortCol == "status") s = d.value("status").toString();
            else if (m_sortCol == "size") n = pr.value("total").toDouble() > 0 ? pr.value("total").toDouble() : d.value("fileSize").toDouble() + d.value("audioSize").toDouble();
            else if (m_sortCol == "speed") n = pr.value("speed").toDouble();
            else if (m_sortCol == "time") n = pr.value("eta").toDouble() > 0 ? pr.value("eta").toDouble() : INFINITY;
            else if (m_sortCol == "progress") n = pr.value("percent").toDouble();
            else if (m_sortCol == "tried") n = QDateTime::fromString(d.value("createdAt").toString(), Qt::ISODate).toMSecsSinceEpoch();
        };
        const bool strCol = m_sortCol == "fileName" || m_sortCol == "status";
        std::stable_sort(rows.begin(), rows.end(), [&](const QJsonObject& a, const QJsonObject& b) {
            QString sa, sb; double na = 0, nb = 0; key(a, sa, na); key(b, sb, nb);
            const int c = strCol ? (sa < sb ? -1 : sa > sb ? 1 : 0) : (na < nb ? -1 : na > nb ? 1 : 0);
            return m_sortAsc ? c < 0 : c > 0;
        });
    }
    m_order.clear(); for (const auto& d : rows) m_order << d.value("id").toString();
    m_list->setRows(rows);
    m_side->setBadge(m_s->list().size());
    updateToolbar();
}

QVector<QJsonObject> MainWindow::selected() const {
    QVector<QJsonObject> out;
    for (const QString& id : m_list->selection()) if (const QJsonObject* d = m_s->find(id)) out << *d;
    return out;
}

void MainWindow::updateToolbar() {
    const auto sel = selected();
    bool canResume = false, canStop = false;
    for (const auto& d : sel) { canResume |= isStartable(d.value("status").toString()); canStop |= isActiveSt(d.value("status").toString()); }
    bool canStopAll = false, canStartQueue = false;
    for (const auto& d : m_s->list()) { canStopAll |= isActiveSt(d.value("status").toString()); canStartQueue |= isStartable(d.value("status").toString()); }
    const bool only = sel.size() == 1 && sel[0].value("status").toString() == "complete" && !sel[0].value("path").toString().isEmpty();
    m_btn["resume"]->setEnabled(canResume); m_btn["stop"]->setEnabled(canStop); m_btn["stop-all"]->setEnabled(canStopAll);
    m_btn["start-queue"]->setEnabled(canStartQueue); m_btn["stop-queue"]->setEnabled(canStopAll);
    m_btn["delete"]->setEnabled(!sel.isEmpty()); m_btn["open-folder"]->setEnabled(only);
}

void MainWindow::onSort(const QString& col) {           // descending, then ascending, then original order
    if (m_sortCol != col) { m_sortCol = col; m_sortAsc = false; }
    else if (!m_sortAsc) m_sortAsc = true;
    else { m_sortCol.clear(); m_sortAsc = true; }
    m_list->setSort(m_sortCol, m_sortAsc);
    refresh();
    m_s->bridge()->invoke("settings:update", QJsonObject{{"list", QJsonObject{{"sortCol", m_sortCol.isEmpty() ? QJsonValue(QJsonValue::Null) : QJsonValue(m_sortCol)}, {"sortAsc", m_sortAsc}}}});
}

void MainWindow::onRowClicked(const QString& id, Qt::KeyboardModifiers m) {
    auto& sel = m_list->selection();
    if (m & (Qt::ControlModifier | Qt::MetaModifier)) { if (sel.contains(id)) sel.remove(id); else sel.insert(id); m_lastSel = id; }
    else if ((m & Qt::ShiftModifier) && !m_lastSel.isEmpty()) {
        const int a = m_order.indexOf(m_lastSel), b = m_order.indexOf(id);
        sel.clear();
        for (int i = qMin(a, b); i <= qMax(a, b); ++i) if (i >= 0) sel.insert(m_order[i]);
    } else { sel.clear(); sel.insert(id); m_lastSel = id; }
    m_list->viewport()->update(); updateToolbar();
}

void MainWindow::selectAll() {
    if (m_order.isEmpty()) return;
    m_list->selection().clear(); for (const QString& id : m_order) m_list->selection().insert(id);
    m_lastSel = m_order.last(); m_list->viewport()->update(); updateToolbar();
}

void MainWindow::openDeleteMenu() {
    if (!m_btn["delete"]->isEnabled()) return;
    auto* m = makeMenu(this, 220); m->setAttribute(Qt::WA_DeleteOnClose);
    auto row = [&](const QString& l, const QString& hint, bool del) {
        auto* wa = new QWidgetAction(m); auto* r = new MenuRow(l, hint); wa->setDefaultWidget(r); m->addAction(wa);
        connect(r, &MenuRow::clicked, this, [this, m, del] { m->close(); applyDeleteChoice(del); });
    };
    row("Delete", "From the list and from disk", true);
    row("Remove", "From the list only", false);
    m->popup(m_btn["delete"]->mapToGlobal(QPoint(qMax(8, 0), m_btn["delete"]->height() + 4)));
}

void MainWindow::applyDeleteChoice(bool deleteFiles) {
    const QStringList ids = QStringList(m_list->selection().values());
    if (ids.isEmpty()) return;
    const int n = ids.size(); const QString label = n == 1 ? "download" : "downloads";
    const QString msg = deleteFiles ? QString("Delete %1 %2 and the files on disk?").arg(n).arg(label)
                                    : QString("Remove %1 %2 from the list? The files stay on disk.").arg(n).arg(label);
    const bool ask = m_s->settings().value("behavior").toObject().value("confirmDelete").toBool(true);
    if (ask && askBox(this, QMessageBox::Question, "Zetta Download Manager", msg, QMessageBox::Yes | QMessageBox::No, QMessageBox::Yes) != QMessageBox::Yes) return;
    for (const QString& id : ids) m_s->bridge()->send("download:remove", QJsonObject{{"id", id}, {"deleteFiles", deleteFiles}});
    m_s->list().erase(std::remove_if(m_s->list().begin(), m_s->list().end(), [&](const QJsonObject& d) { return ids.contains(d.value("id").toString()); }), m_s->list().end());
    m_list->selection().clear(); m_lastSel.clear();
    m_s->listChanged();
}

void MainWindow::openQueueMenu(QWidget* anchor, bool start) {
    auto* m = makeMenu(this, 220); m->setProperty("r6", "1"); m->setAttribute(Qt::WA_DeleteOnClose);
    for (const Queue& q : m_q->queues) {
        bool ready = false;
        for (const auto& d : m_s->list()) {
            const Queue* qq = m_q->queueOf(d.value("id").toString());
            if (!qq || qq->id != q.id) continue;
            const QString st = d.value("status").toString();
            if (start ? isStartable(st) : isActiveSt(st)) { ready = true; break; }
        }
        const QString id = q.id;
        auto* a = m->addAction((start ? "Start " : "Stop ") + QString(q.name).remove(QRegularExpression("[&<>]")));
        a->setEnabled(ready);
        connect(a, &QAction::triggered, this, [this, id, start] { start ? m_q->startNow(id) : m_q->stopNow(id); });
    }
    m->popup(anchor->mapToGlobal(QPoint(0, anchor->height())));
}

void MainWindow::onContext(const QString& id, const QPoint& g) {
    auto openDebug = [] {
        const QString path = QDir::homePath() + QStringLiteral("/zdm-debug.log");
        if (!QFileInfo::exists(path)) QFile(path).open(QIODevice::WriteOnly | QIODevice::Append);
        QDesktopServices::openUrl(QUrl::fromLocalFile(path));
    };
    if (id.isEmpty()) {
        auto* m = makeMenu(this); m->setAttribute(Qt::WA_DeleteOnClose);
        m->addAction("Open debug log", this, openDebug);
        m->popup(g);
        return;
    }
    auto& sel = m_list->selection();
    if (!sel.contains(id)) { sel.clear(); sel.insert(id); m_lastSel = id; m_list->viewport()->update(); updateToolbar(); }
    const auto S = selected();
    bool allComplete = true, allDownloading = true, anyActive = false;
    for (const auto& d : S) { allComplete &= d.value("status").toString() == "complete"; allDownloading &= d.value("status").toString() == "downloading"; anyActive |= isActiveSt(d.value("status").toString()); }
    const bool one = S.size() == 1, haveFile = one && allComplete && !S[0].value("path").toString().isEmpty();
    const QStringList ids = QStringList(sel.values());
    auto* m = makeMenu(this); m->setAttribute(Qt::WA_DeleteOnClose);
    auto act = [&](const QString& text, bool en, std::function<void()> fn) { auto* a = m->addAction(text); a->setEnabled(en); connect(a, &QAction::triggered, this, [fn] { fn(); }); return a; };
    auto send = [this](const char* ch, const QJsonValue& v) { m_s->bridge()->send(ch, v); };
    act("Open", haveFile, [=] { send("download:open-file", S[0].value("path")); });
    act("Open with...", haveFile, [=] { send("download:open-with", S[0].value("path")); });
    act("Open folder", haveFile, [=] { send("download:open-folder", S[0].value("path")); });
    m->addSeparator();
    act("Move/Rename (Ctrl-M)", true, [] {});
    act("Redownload", true, [=] {
        for (const QString& i : ids) if (QJsonObject* d = m_s->find(i)) {
            (*d)["status"] = "downloading"; (*d)["progress"] = QJsonObject{{"downloaded", 0}, {"total", d->value("fileSize")}, {"percent", 0}, {"speed", 0}, {"eta", QJsonValue::Null}};
            send("download:redownload", i);
        }
        refresh();
    });
    m->addSeparator();
    act("Resume Download", !(allComplete || allDownloading), [=] {
        for (const QString& i : ids) { const QJsonObject* d = m_s->find(i); if (d && isStartable(d->value("status").toString())) m_s->setStatusQuiet(i, "downloading"); send("download:resume", i); }
        updateToolbar();
    });
    act("Stop Download", anyActive, [=] {
        for (const QString& i : ids) { const QJsonObject* d = m_s->find(i); if (d && isActiveSt(d->value("status").toString())) m_s->setStatusQuiet(i, "paused"); send("download:pause", i); }
        updateToolbar();
    });
    act("Refresh download address", true, [] {});
    m->addSeparator();
    auto* sub = makeMenu(m, 210, true);
    for (const Queue& q : m_q->choices(ids)) { const QString qid = q.id; sub->addAction(q.name, this, [this, ids, qid] { m_q->assign(ids, qid); }); }
    sub->addAction("Create new queue", this, [this, ids] {
        bool ok; const QString n = QInputDialog::getText(this, "Queue name", "Queue name", QLineEdit::Normal, "", &ok);
        if (ok && !n.trimmed().isEmpty()) { const Queue& nq = m_q->createQueue(n.trimmed()); m_q->assign(ids, nq.id); }
    });
    sub->setTitle("Add to queue"); m->addMenu(sub);
    bool inQueue = false; for (const QString& i : ids) inQueue |= (m_q->queueOf(i) != nullptr);
    act("Delete from queue", inQueue, [=] { m_q->removeFromQueue(ids); });
    m->addSeparator();
    act("Select all (Ctrl+A)", !m_order.isEmpty(), [this] { selectAll(); });
    act("Remove", true, [=] {
        const bool ask = m_s->settings().value("behavior").toObject().value("confirmDelete").toBool(true);
        if (ask && askBox(this, QMessageBox::Question, "Zetta Download Manager", QString("Remove %1 downloads?").arg(ids.size()), QMessageBox::Yes | QMessageBox::No, QMessageBox::Yes) != QMessageBox::Yes) return;
        for (const QString& i : ids) send("download:remove", i);
        m_s->list().erase(std::remove_if(m_s->list().begin(), m_s->list().end(), [&](const QJsonObject& d) { return ids.contains(d.value("id").toString()); }), m_s->list().end());
        m_list->selection().clear(); m_s->listChanged();
    });
    m->addSeparator();
    act("Properties", one, [=] { send("window:open-properties", S[0]); });
    m->addSeparator();
    act("Open debug log", true, openDebug);
    m->popup(g);
}

#include "MainWindow.moc"
