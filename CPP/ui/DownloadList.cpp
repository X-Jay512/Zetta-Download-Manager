#include "DownloadList.h"

static const char* kHeaders[8] = {"", "File Name", "", "Size", "Status", "Speed", "Time Left", "Date Added"};
static const char* kSortKeys[8] = {"", "fileName", "", "size", "status", "speed", "time", "tried"};

static double listedBytes(const QJsonObject& d) {
    const double live = d.value("progress").toObject().value("total").toDouble();
    return live > 0 ? live : d.value("fileSize").toDouble() + d.value("audioSize").toDouble();
}
static QString statusLabel(const QString& s) {
    if (s == "complete") return "Complete";
    if (s == "downloading") return "Downloading";
    if (s == "paused") return "Paused";
    if (s == "queued") return "Queued";
    if (s == "error") return "Failed";
    if (s == "merging" || s == "muxing") return "Assembling";
    return s.isEmpty() ? s : s.left(1).toUpper() + s.mid(1);
}
static QString formatAdded(const QString& iso) {
    const QDateTime t = QDateTime::fromString(iso, Qt::ISODate);
    if (!t.isValid()) return QString();
    const qint64 mins = qMax<qint64>(0, qRound64((QDateTime::currentMSecsSinceEpoch() - t.toMSecsSinceEpoch()) / 60000.0));
    if (mins < 1) return "Just now";
    if (mins < 60) return mins == 1 ? "1 minute ago" : QString("%1 minutes ago").arg(mins);
    const qint64 h = qRound64(mins / 60.0);
    if (h < 24) return h == 1 ? "1 hour ago" : QString("%1 hours ago").arg(h);
    const qint64 d = qRound64(h / 24.0);
    return d == 1 ? "1 day ago" : QString("%1 days ago").arg(d);
}

DownloadList::DownloadList(Store* s, QueueEngine* q, QWidget* parent) : QAbstractScrollArea(parent), m_s(s), m_q(q) {
    viewport()->setMouseTracking(true);
    setMouseTracking(true);
    setFrameShape(QFrame::NoFrame);
    setFocusPolicy(Qt::NoFocus);
    connect(&Theme::I(), &Theme::changed, this, [this] { updateBars(); viewport()->update(); });
    connect(horizontalScrollBar(), &QScrollBar::valueChanged, viewport(), qOverload<>(&QWidget::update));
    connect(verticalScrollBar(), &QScrollBar::valueChanged, viewport(), qOverload<>(&QWidget::update));
}
int DownloadList::hdrH() const { return 8 + QFontMetrics(Theme::uiFont(12, 600)).lineSpacing() + 8 + (Theme::I().lines() ? 1 : 0); }
void DownloadList::setRows(const QVector<QJsonObject>& rows) { m_rows = rows; updateBars(); viewport()->update(); }
void DownloadList::repaintRow(const QString& id) {
    if (const QJsonObject* fresh = m_s->find(id)) {
        for (QJsonObject& row : m_rows) {
            if (row.value("id").toString() == id) { row = *fresh; break; }
        }
    }
    viewport()->update();
}
void DownloadList::updateBars() {
    const int vw = viewport()->width(), vh = viewport()->height();
    horizontalScrollBar()->setRange(0, qMax(0, contentW() - vw)); horizontalScrollBar()->setPageStep(vw);
    verticalScrollBar()->setRange(0, qMax(0, m_rows.size() * rowH() - (vh - hdrH()))); verticalScrollBar()->setPageStep(vh - hdrH());
    verticalScrollBar()->setSingleStep(rowH());
}
int DownloadList::rowAt(int y) const {
    const int ry = y - hdrH() + verticalScrollBar()->value();
    if (y < hdrH() || ry < 0) return -1;
    const int i = ry / rowH();
    return i < m_rows.size() ? i : -1;
}
int DownloadList::headerColAt(int x) const { for (int i = 0; i < 8; ++i) if (x >= colX(i) && x < colX(i) + m_w[i]) return i; return -1; }
bool DownloadList::onResizer(int x, int col) const {           // columns 1..6 carry a .resizer
    if (col < 1 || col > 6) return false;
    const int r = colX(col) + m_w[col];
    return x >= r - 4 && x <= r;
}

void DownloadList::drawHeader(QPainter& p, int W) {
    const Tokens& t = Theme::I().t(); const bool lines = Theme::I().lines();
    const int h = hdrH();
    p.fillRect(QRect(0, 0, viewport()->width(), h), t.bg3);
    if (lines) p.fillRect(QRect(0, h - 1, viewport()->width(), 1), t.border);
    Q_UNUSED(W)
    const QFont f = Theme::uiFont(12, 600);
    for (int i = 0; i < 8; ++i) {
        const QRect cell(colX(i), 0, m_w[i], h);
        if (lines && i < 7) p.fillRect(QRect(cell.right(), 0, 1, h), t.border);
        const bool sortable = kSortKeys[i][0] != 0;
        QColor col = (sortable && m_hoverCol == i) ? t.t1 : t.muted;
        p.save(); p.setClipRect(cell);
        if (i == 2) {
            const QPixmap pm = Theme::I().icon("queues.png", Use::Plain, 16);
            drawPm(p, pm, QRectF(cell.x(), 8, m_w[i], h - 16));
        } else if (kHeaders[i][0]) {
            p.setFont(f); p.setPen(col);
            const QFontMetrics fm(f);
            const QRect tr(cell.x() + 10, 8, m_w[i] - 20, fm.lineSpacing());
            p.drawText(tr, Qt::AlignVCenter | Qt::AlignLeft, kHeaders[i]);
            if (m_sortCol == kSortKeys[i] && sortable) {
                const QFont f10 = Theme::uiFont(10, 600);
                p.setFont(f10); p.setOpacity(.8);
                p.drawText(QRect(tr.x() + fm.horizontalAdvance(kHeaders[i]) + 5, 8, 20, fm.lineSpacing()), Qt::AlignVCenter, m_asc ? QString::fromUtf8("\xE2\x96\xB2") : QString::fromUtf8("\xE2\x96\xBC"));
                p.setOpacity(1);
            }
        }
        p.restore();
        if (onResizer(0, i) || (i >= 1 && i <= 6)) {          // 2px resizer: top 6 / bottom 6
            const bool act = (m_drag == i) || (m_hoverCol == -2 - i);
            p.fillRect(QRect(cell.right() - 1, 6, 2, h - 12), act ? t.accent : t.border2);
        }
    }
}

void DownloadList::drawRow(QPainter& p, const QJsonObject& d, int y, int W) {
    const Tokens& t = Theme::I().t(); const bool lines = Theme::I().lines();
    const int rh = rowH();
    const QString id = d.value("id").toString(), status = d.value("status").toString();
    const QJsonObject pr = d.value("progress").toObject();
    const QRect row(0, y, W, rh);
    if (m_sel.contains(id)) p.fillRect(row, Theme::I().selBrush(row));
    else if (m_hoverId == id) p.fillRect(row, t.hover);
    if (lines) p.fillRect(QRect(0, y + rh - 1, W, 1), t.border);

    const QFont f12 = Theme::uiFont(12), f12m = Theme::uiFont(12, 500), f11b = Theme::uiFont(11, 600);
    const int ls12 = QFontMetrics(f12).lineSpacing();
    auto cellRect = [&](int i) { return QRect(colX(i), y, m_w[i], rh - (lines ? 1 : 0)); };
    auto topText = [&](int i, const QString& s, const QColor& c, const QFont& f) {         // display:block; padding 8px 10px
        const QRect cr = cellRect(i);
        p.setFont(f); p.setPen(c);
        const QRect tr(cr.x() + 10, cr.y() + 8, cr.width() - 20, QFontMetrics(f).lineSpacing());
        p.drawText(tr, Qt::AlignVCenter | Qt::AlignLeft, QFontMetrics(f).elidedText(s, Qt::ElideRight, tr.width()));
    };
    if (lines) for (int i = 0; i < 7; ++i) p.fillRect(QRect(cellRect(i).right(), y, 1, rh), t.border);

    // 0 icon (cell padding 4, 32x32)
    {
        const QPixmap pm = Theme::fileIcon(d.value("path").toString().isEmpty() ? d.value("fileName").toString() : d.value("path").toString(), 32);
        const QRect cr = cellRect(0);
        p.drawPixmap(QRect(cr.x() + (cr.width() - 32) / 2, y + 4, 32, 32), pm);
    }
    // 1 name (flex column, centred, padding-right 8)
    {
        const QRect cr = cellRect(1);
        p.setFont(f12); p.setPen(t.t1);
        const QRect tr(cr.x() + 10, y, cr.width() - 20 - 8, rh);
        p.drawText(tr, Qt::AlignVCenter | Qt::AlignLeft, QFontMetrics(f12).elidedText(d.value("fileName").toString("Unknown"), Qt::ElideRight, tr.width()));
    }
    // 2 queue
    if (const Queue* q = m_q->queueOf(id)) {
        const QRectF cr = cellRect(2);
        if (q->id == "main") drawPm(p, Theme::I().icon("main-queues.png", Use::Plain, 16), cr);
        else if (q->id == "sync") drawPm(p, Theme::I().icon("sync.png", Use::Plain, 16), cr);
        else paintQueueNum(p, cr.center(), m_q->customIndex(q->id), Use::Plain);
    }
    // 3 size
    topText(3, d.value("duration").toDouble() > 0 ? fmtDuration(d.value("duration").toDouble()) : fmtSize(listedBytes(d)), t.t2, f12);
    // 4 status
    {
        const bool showBar = status == "downloading" || status == "merging" || status == "paused" || status == "muxing" || status == "connecting";
        const QRect cr = cellRect(4);
        const bool hasPct = !pr.value("percent").isNull() && !pr.value("percent").isUndefined();
        const int pct = hasPct ? qRound(pr.value("percent").toDouble()) : 0;
        if (showBar) {
            const QString text = hasPct ? QString("%1% %2").arg(pct).arg(statusLabel(status)) : statusLabel(status);
            const int tl = QFontMetrics(f11b).lineSpacing();
            const int total = tl + 3 + 3, top = cr.y() + 8 + ((cr.height() - 16) - total) / 2;
            p.setFont(f11b); p.setPen(t.t2);
            p.drawText(QRect(cr.x() + 10, top, cr.width() - 20, tl), Qt::AlignVCenter | Qt::AlignLeft, QFontMetrics(f11b).elidedText(text, Qt::ElideRight, cr.width() - 20));
            const QRectF bar(cr.x() + 10, top + tl + 3, cr.width() - 20, 3);
            p.setRenderHint(QPainter::Antialiasing);
            QPainterPath bp; bp.addRoundedRect(bar, 2, 2); p.fillPath(bp, t.active);
            QRectF fill = bar; fill.setWidth(bar.width() * qBound(0, pct, 100) / 100.0);
            QPainterPath fp; fp.addRoundedRect(fill, 2, 2);
            const bool mux = status == "merging" || status == "muxing";
            p.fillPath(fp, status == "paused" ? QBrush(t.warn) : mux ? Theme::I().accentBrush(bar) : QBrush(t.ok));
        } else {
            QColor c = t.t1;
            if (status == "error") c = t.danger; else if (status == "queued") c = t.muted;
            const QString text = statusLabel(status);
            const int tl = QFontMetrics(f11b).lineSpacing();
            p.setFont(f11b); p.setPen(c);
            p.drawText(QRect(cr.x() + 10, cr.y() + 8 + (ls12 - tl) / 2, cr.width() - 20, tl), Qt::AlignVCenter | Qt::AlignLeft, QFontMetrics(f11b).elidedText(text, Qt::ElideRight, cr.width() - 20));
        }
    }
    const bool live = status == "downloading" || status == "merging" || status == "connecting";
    // 5 speed / 6 eta / 7 added
    topText(5, live ? (pr.value("speed").toDouble() > 0 ? fmtSize(pr.value("speed").toDouble()) + "/s" : QString::fromUtf8("\xE2\x80\x94")) : QString(), t.accent, f12m);
    topText(6, live ? fmtTimeShort(pr.value("eta").toDouble()) : QString(), t.t2, f12);
    topText(7, formatAdded(d.value("createdAt").toString()), t.t2, f12);
}

void DownloadList::paintEvent(QPaintEvent*) {
    QPainter p(viewport());
    const Tokens& t = Theme::I().t();
    const int vw = viewport()->width(), vh = viewport()->height(), W = qMax(contentW(), vw), h0 = hdrH();
    p.fillRect(viewport()->rect(), t.bg1);
    if (m_rows.isEmpty()) {
        const QPixmap pm = Theme::I().icon("download.png", Use::Empty, 72);
        const QFont f = Theme::uiFont(14);
        const int tl = QFontMetrics(f).lineSpacing();
        const int total = 72 + 12 + tl, top = h0 + (vh - h0 - total) / 2;
        drawPm(p, pm, QRectF(vw / 2.0 - 36, top, 72, 72));
        p.setFont(f); p.setPen(t.muted);
        p.drawText(QRect(vw / 2 - 210, top + 72 + 12, 420, tl * 3), Qt::AlignHCenter | Qt::AlignTop | Qt::TextWordWrap,
                   QString::fromUtf8("No downloads yet \xE2\x80\x94 press Add URL or install the browser extension"));
    } else {
        p.save(); p.setClipRect(QRect(0, h0, vw, vh - h0));
        const int vs = verticalScrollBar()->value();
        const int first = vs / rowH(), last = qMin(m_rows.size() - 1, (vs + vh - h0) / rowH());
        for (int i = first; i <= last; ++i) drawRow(p, m_rows[i], h0 + i * rowH() - vs, W);
        p.restore();
    }
    drawHeader(p, W);
}

void DownloadList::mousePressEvent(QMouseEvent* e) {
    if (e->button() != Qt::LeftButton) return;
    const QPoint pt = e->pos();
    if (pt.y() < hdrH()) {
        const int c = headerColAt(pt.x());
        for (int i = 1; i <= 6; ++i) if (onResizer(pt.x(), i)) { m_drag = i; m_dragX = pt.x(); m_dragW = m_w[i]; return; }
        if (c >= 0 && kSortKeys[c][0]) emit sortClicked(kSortKeys[c]);
        return;
    }
    const int r = rowAt(pt.y());
    if (r < 0) { emit blankClicked(); return; }
    emit rowClicked(m_rows[r].value("id").toString(), e->modifiers());
}
void DownloadList::mouseMoveEvent(QMouseEvent* e) {
    if (m_drag >= 0) { m_w[m_drag] = qMax(40, m_dragW + e->pos().x() - m_dragX); updateBars(); viewport()->update(); return; }
    const QPoint pt = e->pos();
    bool res = false;
    if (pt.y() < hdrH()) for (int i = 1; i <= 6; ++i) if (onResizer(pt.x(), i)) { res = true; break; }
    viewport()->setCursor(res ? Qt::SplitHCursor : Qt::ArrowCursor);
    const int hc = pt.y() < hdrH() ? headerColAt(pt.x()) : -1;
    const int r = rowAt(pt.y());
    const QString hid = r >= 0 ? m_rows[r].value("id").toString() : QString();
    if (hc != m_hoverCol || hid != m_hoverId) { m_hoverCol = hc; m_hoverId = hid; viewport()->update(); }
}
void DownloadList::mouseReleaseEvent(QMouseEvent*) { if (m_drag >= 0) { m_drag = -1; viewport()->update(); } }
void DownloadList::mouseDoubleClickEvent(QMouseEvent* e) {
    const int r = rowAt(e->pos().y());
    if (r >= 0) emit rowDoubleClicked(m_rows[r].value("id").toString());
}
void DownloadList::contextMenuEvent(QContextMenuEvent* e) {
    const int r = rowAt(e->pos().y());
    emit contextRequested(r >= 0 ? m_rows[r].value("id").toString() : QString(), e->globalPos());
}
