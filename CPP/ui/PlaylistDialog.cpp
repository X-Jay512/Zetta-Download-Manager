#include "Dialogs.h"
#include <cmath>
#include <memory>

namespace {
class ListFrame : public QWidget {                  // .list: border 1px --border, radius 6, bg --bg-primary
public:
    ListFrame(QWidget* p) : QWidget(p) { connect(&Theme::I(), &Theme::changed, this, [this] { update(); }); }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        QPainterPath o; o.addRoundedRect(QRectF(rect()), 6, 6); p.fillPath(o, t.border);
        QPainterPath i; i.addRoundedRect(QRectF(rect()).adjusted(1, 1, -1, -1), 5, 5); p.fillPath(i, t.bg1);
    }
};
class RowW : public QWidget {                       // .cols / .item  (grid 28px 1fr 108px 108px 78px 52px, gap 6, padding 6px 8px)
public:
    RowW(bool header, QWidget* p) : QWidget(p), m_h(header) { connect(&Theme::I(), &Theme::changed, this, [this] { update(); }); }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(this);
        if (m_h) p.fillRect(rect(), t.bg3);
        p.fillRect(QRect(0, height() - 1, width(), 1), t.border);
    }
private:
    bool m_h;
};
QWidget* colW(QWidget* w, int width) { w->setFixedWidth(width); return w; }
}

static QString videoLabel(int h) { return h >= 2160 ? "4K" : h >= 1440 ? "1440p" : QString::number(h) + "p"; }
static QString fmtDur(double s) { if (!s) return QString(); const int r = qRound(s); return QString("%1:%2").arg(r / 60).arg(r % 60, 2, 10, QChar('0')); }

PlaylistDialog::PlaylistDialog(Bridge* b, const QString& preset) : FramelessWindow([] { TitleSpec s; s.h = 32; s.caption = "Add playlist"; s.border = true; s.buttons = 1; return s; }(), true, true), m_b(b) {
    resize(640, 520); setMinimumSize(640, 520);
    auto* v = vbox(body(), 8, QMargins(12, 12, 12, 12));
    auto* r1 = new QWidget; auto* h1 = hbox(r1, 8);
    m_url = makeEdit("pl"); m_url->setPlaceholderText("YouTube playlist or page link"); m_url->setMinimumWidth(180); m_url->setClearButtonEnabled(false); h1->addWidget(m_url, 1);
    m_load = new PushButton(PushButton::Secondary, "Load"); h1->addWidget(m_load);
    auto lab = [&](const QString& t, QComboBox* c) { auto* w = new QWidget; auto* h = hbox(w, 4); h->addWidget(makeLabel(t, 12, 400, "t1")); h->addWidget(c); h1->addWidget(w); };
    m_vq = makeCombo("pl"); m_vq->addItem("Highest", "max"); m_aq = makeCombo("pl"); m_aq->addItem("Highest", "max");
    lab("Video", m_vq); lab("Audio", m_aq); v->addWidget(r1);
    auto* r2 = new QWidget; auto* h2 = hbox(r2, 8);
    m_all = new ChkBox("All"); m_onlyAudio = new ChkBox("Only audio"); h2->addWidget(m_all); h2->addWidget(m_onlyAudio);
    m_queue = makeCombo("pl"); { auto* w = new QWidget; auto* h = hbox(w, 4); h->addWidget(makeLabel("Queue", 12, 400, "t1")); h->addWidget(m_queue); h2->addWidget(w); }
    m_newQ = makeEdit("pl"); m_newQ->setPlaceholderText("New queue name"); m_newQ->setMinimumWidth(180); m_newQ->hide(); h2->addWidget(m_newQ); h2->addStretch(1);
    v->addWidget(r2);
    // list
    auto* frame = new ListFrame(this); auto* fv = vbox(frame, 0, QMargins(1, 1, 1, 1));
    auto mkRow = [&](RowW* row, const QVector<QWidget*>& cells) {
        auto* h = hbox(row, 6, QMargins(8, 6, 8, 6));
        for (int i = 0; i < cells.size(); ++i) h->addWidget(cells[i], i == 1 ? 1 : 0, Qt::AlignVCenter);
    };
    auto* hdr = new RowW(true, frame);
    auto hl = [&](const QString& t, bool center) { auto* l = makeLabel(t, 12, 600, "muted"); if (center) l->setAlignment(Qt::AlignCenter); return l; };
    mkRow(hdr, {colW(new QWidget, 28), hl("Title", false), colW(hl("Video", false), 108), colW(hl("Audio", false), 108), colW(hl("Size", true), 78), colW(hl("Time", true), 52)});
    fv->addWidget(hdr);
    auto* sc = new QScrollArea; sc->setWidgetResizable(true); sc->setFrameShape(QFrame::NoFrame); sc->viewport()->setAutoFillBackground(false); sc->viewport()->setStyleSheet("background: transparent;");
    m_rows = new QWidget; m_rows->setAutoFillBackground(false); m_rows->setStyleSheet("background: transparent;"); m_rowsLayout = vbox(m_rows, 0); m_rowsLayout->setAlignment(Qt::AlignTop);
    sc->setWidget(m_rows); fv->addWidget(sc, 1);
    v->addWidget(frame, 1);
    m_status = makeLabel("", 12, 400, "t2"); m_status->setMinimumHeight(16); v->addWidget(m_status);
    auto* ar = new QWidget; auto* ah = hbox(ar, 8); ah->addStretch(1);
    m_dl = new PushButton(PushButton::Primary, "Download"); auto* close = new PushButton(PushButton::Secondary, "Close"); ah->addWidget(m_dl); ah->addWidget(close); v->addWidget(ar);

    connect(m_load, &QAbstractButton::clicked, this, [this] { load(); });
    connect(m_url, &QLineEdit::returnPressed, this, [this] { load(); });
    connect(m_all, &QCheckBox::toggled, this, [this](bool on) { for (auto& x : m_vids) x.checked = on; paintList(); });
    connect(m_vq, qOverload<int>(&QComboBox::currentIndexChanged), this, [this] { applyGlobals(); paintList(); });
    connect(m_aq, qOverload<int>(&QComboBox::currentIndexChanged), this, [this] { applyGlobals(); paintList(); });
    connect(m_onlyAudio, &QCheckBox::toggled, this, [this] { paintList(); });
    connect(m_queue, qOverload<int>(&QComboBox::currentIndexChanged), this, [this] { m_newQ->setVisible(m_queue->currentData().toString() == "new"); });
    connect(m_dl, &QAbstractButton::clicked, this, [this] { startDownload(); });
    connect(close, &QAbstractButton::clicked, this, [this] { this->close(); });
    loadQueues();
    if (!preset.isEmpty()) { m_url->setText(preset); QTimer::singleShot(0, this, [this] { load(); }); }
}

void PlaylistDialog::loadQueues() {
    const QString cur = m_queue->currentData().toString();
    QSignalBlocker sb(m_queue);
    m_queue->clear(); m_queue->addItem("Start now", "");
    for (const auto& q : m_b->invoke("playlist:queues").toArray()) m_queue->addItem(q.toObject().value("name").toString(), q.toObject().value("id").toString());
    m_queue->addItem(QString::fromUtf8("New queue\xE2\x80\xA6"), "new");
    const int i = m_queue->findData(cur); if (i >= 0) m_queue->setCurrentIndex(i);
}

static int pickVideo(const QVector<int>& heights, const QString& choice) {
    if (heights.isEmpty()) return 0;
    if (choice == "max") return heights[0];
    const int h = choice.toInt();
    for (int x : heights) if (x == h) return x;
    for (int x : heights) if (x <= h) return x;
    return heights[0];
}
void PlaylistDialog::applyGlobals() {
    for (auto& vd : m_vids) {
        QVector<int> hs, as; for (const auto& f : vd.v) hs << f.height; for (const auto& f : vd.a) as << f.abr;
        vd.vh = pickVideo(hs, m_vq->currentData().toString());
        const QString ac = m_aq->currentData().toString();
        if (as.isEmpty()) vd.ab = 0; else if (ac == "max") vd.ab = as[0]; else { const int a = ac.toInt(); int pick = as[0]; bool f = false; for (int x : as) if (x == a) { pick = x; f = true; break; } if (!f) for (int x : as) if (x && x <= a) { pick = x; break; } vd.ab = pick; }
    }
}
void PlaylistDialog::syncGlobals() {
    QSet<int> hs, as; for (const auto& vd : m_vids) { for (const auto& f : vd.v) hs.insert(f.height); for (const auto& f : vd.a) if (f.abr) as.insert(f.abr); }
    QList<int> hl = hs.values(), al = as.values(); std::sort(hl.begin(), hl.end(), std::greater<int>()); std::sort(al.begin(), al.end(), std::greater<int>());
    auto fill = [](QComboBox* c, const QList<int>& vals, const std::function<QString(int)>& label) {
        const QString cur = c->currentData().toString(); QSignalBlocker sb(c); c->clear(); c->addItem("Highest", "max");
        for (int x : vals) c->addItem(label(x), QString::number(x));
        const int i = c->findData(cur); c->setCurrentIndex(i >= 0 ? i : 0);
    };
    fill(m_vq, hl, [](int h) { return videoLabel(h); }); fill(m_aq, al, [](int a) { return QString::number(a) + " kbps"; });
}
double PlaylistDialog::rowBytes(const Vid& vd) const {
    double ab = 0; for (const auto& f : vd.a) if (f.abr == vd.ab) { ab = f.size; break; } if (!ab && !vd.a.isEmpty()) ab = vd.a[0].size;
    if (m_onlyAudio->isChecked()) return ab;
    double vb = 0; bool found = false; for (const auto& f : vd.v) if (f.height == vd.vh) { vb = f.size; found = true; break; } if (!found && !vd.v.isEmpty()) vb = vd.v[0].size;
    return vb + ab;
}

void PlaylistDialog::paintList() {
    auto* sc = qobject_cast<QScrollArea*>(m_rows->parentWidget()->parentWidget()); const int keep = sc ? sc->verticalScrollBar()->value() : 0;
    while (QLayoutItem* it = m_rowsLayout->takeAt(0)) { if (it->widget()) { it->widget()->hide(); it->widget()->deleteLater(); } delete it; }
    const bool only = m_onlyAudio->isChecked();
    for (int i = 0; i < m_vids.size(); ++i) {
        Vid& vd = m_vids[i];
        auto* row = new RowW(false, m_rows); auto* h = hbox(row, 6, QMargins(8, 6, 8, 6));
        auto* cb = new ChkBox; cb->setChecked(vd.checked); auto* cw = new QWidget; cw->setFixedWidth(28); auto* cwl = hbox(cw, 0); cwl->addWidget(cb); cwl->addStretch(1); h->addWidget(cw);
        const QString title = vd.entry.value("title").toString();
        auto* tl = makeLabel("", 12, 400, "t1"); tl->setToolTip(title); tl->setMinimumWidth(0); tl->setSizePolicy(QSizePolicy::Ignored, QSizePolicy::Preferred);
        tl->setText(QFontMetrics(tl->font()).elidedText(title, Qt::ElideRight, 380)); h->addWidget(tl, 1);
        auto* vc = makeCombo("pl"); vc->setFixedWidth(108); vc->setEnabled(!only);
        if (vd.v.isEmpty()) vc->addItem(QString::fromUtf8("\xE2\x80\xA6"), ""); else for (const auto& f : vd.v) vc->addItem(videoLabel(f.height), f.height);
        { const int ix = vc->findData(vd.vh); if (ix >= 0) vc->setCurrentIndex(ix); }
        auto* ac = makeCombo("pl"); ac->setFixedWidth(108);
        if (vd.a.isEmpty()) ac->addItem(QString::fromUtf8("\xE2\x80\xA6"), ""); else for (const auto& f : vd.a) ac->addItem(f.abr ? QString::number(f.abr) + " kbps" : f.ext, f.abr);
        { const int ix = ac->findData(vd.ab); if (ix >= 0) ac->setCurrentIndex(ix); }
        h->addWidget(vc); h->addWidget(ac);
        auto* sz = makeLabel(fmtSize(rowBytes(vd), 1), 12, 400, "t2"); sz->setAlignment(Qt::AlignCenter); sz->setFixedWidth(78); h->addWidget(sz);
        auto* tm = makeLabel(fmtDur(vd.entry.value("duration").toDouble()), 12, 400, "t2"); tm->setAlignment(Qt::AlignCenter); tm->setFixedWidth(52); h->addWidget(tm);
        m_rowsLayout->addWidget(row);
        connect(cb, &QCheckBox::toggled, this, [this, i](bool on) { if (i < m_vids.size()) { m_vids[i].checked = on; QTimer::singleShot(0, this, [this] { paintList(); }); } });
        connect(vc, qOverload<int>(&QComboBox::activated), this, [this, i, vc] { if (i < m_vids.size()) { m_vids[i].vh = vc->currentData().toInt(); QTimer::singleShot(0, this, [this] { paintList(); }); } });
        connect(ac, qOverload<int>(&QComboBox::activated), this, [this, i, ac] { if (i < m_vids.size()) { m_vids[i].ab = ac->currentData().toInt(); QTimer::singleShot(0, this, [this] { paintList(); }); } });
    }
    if (sc) QTimer::singleShot(0, sc, [sc, keep] { sc->verticalScrollBar()->setValue(keep); });
    int sel = 0, ready = 0; double total = 0;
    for (const auto& vd : m_vids) { if (vd.checked) { ++sel; total += rowBytes(vd); } if (vd.probed) ++ready; }
    m_status->setText(m_vids.isEmpty() ? QString() : QString("%1 selected \xC2\xB7 Total %2").arg(sel).arg(fmtSize(total, 1)) + (ready < m_vids.size() ? QString(" \xC2\xB7 reading %1/%2").arg(ready).arg(m_vids.size()) : QString()));
}

void PlaylistDialog::load() {
    const QString url = m_url->text().trimmed();
    if (url.isEmpty() || m_probing) return;
    m_status->setText(QString::fromUtf8("Loading playlist\xE2\x80\xA6")); m_load->setEnabled(false);
    m_b->invokeAsync("playlist:list", url, [this, url](const QJsonValue& val, const QString& err) {
        if (!err.isEmpty()) { m_status->setText(err); m_load->setEnabled(true); return; }
        m_vids.clear();
        for (const auto& e : val.toArray()) { Vid vd; vd.entry = e.toObject(); m_vids.append(vd); }
        QSignalBlocker sb(m_all); m_all->setChecked(true);
        paintList();
        if (!m_vids.isEmpty()) m_b->invoke("playlist:remember", QJsonObject{{"url", url}, {"name", m_vids[0].entry.value("playlistTitle").toString(m_vids[0].entry.value("title").toString("Playlist"))}});
        m_load->setEnabled(true); probeAll();
    });
}
void PlaylistDialog::probeAll() {
    m_probing = true; m_cursor = 0; m_alive = 3;
    auto worker = std::make_shared<std::function<void()>>();
    *worker = [this, worker] {
        if (m_cursor >= m_vids.size()) { if (--m_alive == 0) { m_probing = false; paintList(); } return; }
        const int idx = m_cursor++;
        m_b->invokeAsync("playlist:formats", m_vids[idx].entry.value("url"), [this, idx, worker](const QJsonValue& val, const QString& err) {
            if (idx < m_vids.size()) {
                Vid& vd = m_vids[idx]; vd.v.clear(); vd.a.clear(); vd.probed = true;
                if (err.isEmpty()) {
                    const QJsonObject info = val.toObject();
                    for (const auto& x : info.value("videos").toArray()) { const QJsonObject o = x.toObject(); Fmt f; f.id = o.value("id").toString(); f.ext = o.value("ext").toString(); f.height = o.value("height").toInt(); f.size = o.value("size").toDouble(); vd.v << f; }
                    for (const auto& x : info.value("audios").toArray()) { const QJsonObject o = x.toObject(); Fmt f; f.id = o.value("id").toString(); f.ext = o.value("ext").toString(); f.abr = o.value("abr").toInt(); f.size = o.value("size").toDouble(); vd.a << f; }
                }
                applyGlobals(); syncGlobals(); paintList();
            }
            (*worker)();
        });
    };
    for (int i = 0; i < 3; ++i) (*worker)();
}

void PlaylistDialog::startDownload() {
    QJsonArray picked;
    for (const auto& vd : m_vids) {
        if (!vd.checked) continue;
        QString vid, aid, aext = "m4a";
        for (const auto& f : vd.v) if (f.height == vd.vh) { vid = f.id; break; } if (vid.isEmpty() && !vd.v.isEmpty()) vid = vd.v[0].id;
        for (const auto& f : vd.a) if (f.abr == vd.ab) { aid = f.id; aext = f.ext; break; } if (aid.isEmpty() && !vd.a.isEmpty()) { aid = vd.a[0].id; aext = vd.a[0].ext; }
        picked.append(QJsonObject{{"url", vd.entry.value("url")}, {"title", vd.entry.value("title")}, {"id", vd.entry.value("id")}, {"videoId", vid}, {"audioId", aid}, {"audioExt", aext}});
    }
    if (picked.isEmpty()) { m_status->setText("Select at least one video"); return; }
    QString queueId = m_queue->currentData().toString();
    if (queueId == "new") {
        const QString name = m_newQ->text().trimmed();
        if (name.isEmpty()) { m_status->setText("Name the new queue"); return; }
        const QString id = m_b->invoke("playlist:create-queue", name).toObject().value("id").toString();
        if (id.isEmpty()) { m_status->setText("Could not create the queue"); return; }
        queueId = id; loadQueues(); m_queue->setCurrentIndex(m_queue->findData(queueId)); m_newQ->hide();
    }
    m_dl->setEnabled(false); m_status->setText(QString::fromUtf8("Starting\xE2\x80\xA6"));
    const QJsonObject res = m_b->invoke("playlist:add", QJsonObject{{"videos", picked}, {"onlyAudio", m_onlyAudio->isChecked()}, {"queueOnly", !queueId.isEmpty()}, {"page", m_url->text().trimmed()}}).toObject();
    if (!queueId.isEmpty() && !res.value("ids").toArray().isEmpty()) m_b->invoke("playlist:assign", QJsonObject{{"ids", res.value("ids")}, {"queueId", queueId}});
    m_status->setText(QString::number(res.value("added").toInt()) + " added" + (res.value("failed").toInt() ? ", " + QString::number(res.value("failed").toInt()) + " failed" : QString()));
    m_dl->setEnabled(true);
}
