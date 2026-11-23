#include "Dialogs.h"
#include "ExtensionPanel.h"
#include "MainWindow.h"

#include <QTimer>

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

// =================================================================== shared bits
CopyBtn::CopyBtn(int box, int glyph, QWidget* p) : QAbstractButton(p), m_glyph(glyph) {
    setFixedSize(box, box); setAttribute(Qt::WA_Hover); setCursor(Qt::PointingHandCursor); setToolTip("Copy link"); setFocusPolicy(Qt::NoFocus);
}
void CopyBtn::flashCopied() { m_copied = true; setToolTip("Copied"); update(); QTimer::singleShot(1200, this, [this] { m_copied = false; setToolTip("Copy link"); update(); }); }
void CopyBtn::paintEvent(QPaintEvent*) {
    const Tokens& t = Theme::I().t();
    QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
    if (underMouse()) { QPainterPath bg; bg.addRoundedRect(QRectF(rect()), width() >= 26 ? 6 : 4, width() >= 26 ? 6 : 4); p.fillPath(bg, t.hover); }
    p.translate((width() - m_glyph) / 2.0, (height() - m_glyph) / 2.0); p.scale(m_glyph / 24.0, m_glyph / 24.0);
    p.setPen(QPen(m_copied ? t.accent : t.t1, 1.8, Qt::SolidLine, Qt::RoundCap, Qt::RoundJoin)); p.setBrush(Qt::NoBrush);
    p.drawRoundedRect(QRectF(8, 8, 12, 12), 2, 2);
    QPainterPath pa; pa.moveTo(6, 16); pa.lineTo(5, 16); pa.arcTo(QRectF(3, 12, 4, 4), 270, -90);
    pa.lineTo(3, 5); pa.arcTo(QRectF(3, 3, 4, 4), 180, -90);
    pa.lineTo(14, 3); pa.arcTo(QRectF(12, 3, 4, 4), 90, -90);
    pa.lineTo(16, 6);
    p.drawPath(pa);
}
GlyphBtn::GlyphBtn(const QString& g, int px, QWidget* p) : QAbstractButton(p), m_g(g), m_px(px) { setCursor(Qt::ArrowCursor); setAttribute(Qt::WA_Hover); setFocusPolicy(Qt::NoFocus); }
void GlyphBtn::paintEvent(QPaintEvent*) {
    QPainter p(this); p.setFont(Theme::uiFont(m_px)); p.setPen(underMouse() ? Theme::I().t().t1 : Theme::I().t().t2);
    p.drawText(rect(), Qt::AlignCenter, m_g);
}
QLineEdit* makeEdit(const char* v, QWidget* p, bool ro) { auto* e = new QLineEdit(p); e->setProperty("v", v); e->setReadOnly(ro); e->setFont(Theme::uiFont(12)); return e; }
QComboBox* makeCombo(const char* v, QWidget* p) { auto* c = new QComboBox(p); c->setView(new QListView(c)); c->setProperty("v", v); c->setFont(Theme::uiFont(12)); return c; }
static void copyText(const QString& text, CopyBtn* b) { if (text.trimmed().isEmpty()) return; QApplication::clipboard()->setText(text.trimmed()); b->flashCopied(); }
static QWidget* labeledRow(const QString& label, QWidget* field, int labelW, int gap, const char* tok = "t2") {
    auto* w = new QWidget; auto* h = hbox(w, gap, QMargins());
    auto* l = makeLabel(label, 12, 400, tok); l->setFixedWidth(labelW); h->addWidget(l); h->addWidget(field, 1); return w;
}
static void centerOnScreen(QWidget* w) {
    if (!w) return;
    QScreen* screen = QGuiApplication::screenAt(QCursor::pos());
    if (!screen) screen = QGuiApplication::primaryScreen();
    if (!screen) return;
    const QRect area = screen->availableGeometry();
    const QSize sz = w->size().expandedTo(w->minimumSizeHint());
    w->move(area.x() + (area.width() - sz.width()) / 2, area.y() + (area.height() - sz.height()) / 2);
}
static void bringToFront(QWidget* w) {
    if (!w) return;
    if (w->isMinimized()) w->showNormal();
    centerOnScreen(w);
    w->show();
    w->raise();
    w->activateWindow();
    QTimer::singleShot(0, w, [w] {
        centerOnScreen(w);
        const HWND hwnd = reinterpret_cast<HWND>(w->winId());
        if (!hwnd) return;
        const HWND foreground = GetForegroundWindow();
        const DWORD foregroundThread = foreground ? GetWindowThreadProcessId(foreground, nullptr) : 0;
        const DWORD ourThread = GetCurrentThreadId();
        const bool attached = foregroundThread && foregroundThread != ourThread && AttachThreadInput(foregroundThread, ourThread, TRUE);
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        if (attached) AttachThreadInput(foregroundThread, ourThread, FALSE);
    });
}
static void showWin(QWidget* w) { w->setAttribute(Qt::WA_DeleteOnClose); bringToFront(w); }

// =================================================================== AddDialog
static TitleSpec addSpec() { TitleSpec s; s.h = 28; s.barClear = true; s.border = false; s.buttons = 1; s.winBg = TitleSpec::Card; return s; }

class DupChoice : public QWidget {               // .dup-choice
public:
    DupChoice(const QString& title, const QString& small, const QString& key, QButtonGroup* g, QWidget* p) : QWidget(p) {
        setCursor(Qt::PointingHandCursor);
        auto* h = hbox(this, 8, QMargins(10, 6, 10, 6)); h->setAlignment(Qt::AlignTop);
        radio = new RadBox; radio->setFixedSize(21, 15); radio->setProperty("key", key); g->addButton(radio); h->addWidget(radio, 0, Qt::AlignTop);
        auto* col = new QWidget; auto* v = vbox(col, 1);
        v->addWidget(makeLabel(title, 12, 650, "t1")); auto* s = makeLabel(small, 11, 400, "muted"); s->setWordWrap(true); v->addWidget(s);
        h->addWidget(col, 1);
        connect(radio, &QAbstractButton::toggled, this, [this] { update(); });
        connect(&Theme::I(), &Theme::changed, this, [this] { update(); });
        for (auto* c : col->findChildren<QLabel*>()) c->setAttribute(Qt::WA_TransparentForMouseEvents);
    }
    RadBox* radio;
protected:
    void mouseReleaseEvent(QMouseEvent*) override { radio->click(); }
    void paintEvent(QPaintEvent*) override {
        const Theme& th = Theme::I(); const Tokens& t = th.t();
        QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        const bool on = radio->isChecked(); const qreal bw = th.is3() ? 1.5 : 1.0;
        const QRectF r(rect());
        QPainterPath o; o.addRoundedRect(r, 4, 4);
        p.fillPath(o, (on && th.is3()) ? th.accentBrush(r) : QBrush(on ? t.accent : t.border));
        QPainterPath i; i.addRoundedRect(r.adjusted(bw, bw, -bw, -bw), qMax(0.0, 4 - bw), qMax(0.0, 4 - bw));
        p.fillPath(i, t.bg1);
    }
};

AddDialog::AddDialog(Bridge* b, const QJsonObject& data) : FramelessWindow(addSpec(), false, false), m_b(b) {
    m_settings = b->invoke("settings:get").toObject();
    auto* root = vbox(body(), 0);
    // ------------------------------------------------ page: file info
    m_pageAdd = new QWidget; auto* pv = vbox(m_pageAdd, 0);
    auto* bodyW = new QWidget; auto* bv = vbox(bodyW, 0, QMargins(16, 12, 16, 6));
    auto* fi = new QWidget; auto* fh = hbox(fi, 12); fh->setAlignment(Qt::AlignTop);
    auto* form = new QWidget; auto* fv = vbox(form, 0); fv->setAlignment(Qt::AlignTop);
    m_kind = makeCombo("info"); m_kind->setFixedWidth(110);
    const QPair<const char*, const char*> kinds[] = {{"general", "General"}, {"compressed", "Compressed"}, {"documents", "Documents"}, {"music", "Sounds"}, {"programs", "Programs"}, {"video", "Video"}, {"images", "Images"}};
    for (auto& k : kinds) m_kind->addItem(k.second, k.first);
    m_name = makeEdit("info"); m_name->setPlaceholderText("File name");
    auto* sa = new QWidget; auto* sah = hbox(sa, 6); sah->addWidget(m_kind); sah->addWidget(m_name, 1);
    fv->addWidget(labeledRow("Save as", sa, 68, 6)); fv->addSpacing(5);
    m_remember = new ChkBox("Remember this folder for General");
    auto* rr = new QWidget; auto* rh = hbox(rr, 0, QMargins(74, 0, 0, 0)); rh->addWidget(m_remember); rh->addStretch(1);
    fv->addWidget(rr); fv->addSpacing(7);
    m_path = makeEdit("info", nullptr, true);
    auto* browse = new PushButton(PushButton::Secondary, "..."); browse->metrics(10, 5, 4, 500);
    auto* pw = new QWidget; auto* ph = hbox(pw, 6); ph->addWidget(m_path, 1); ph->addWidget(browse);
    fv->addWidget(labeledRow("Folder", pw, 68, 6)); fv->addSpacing(7);
    m_desc = makeEdit("info"); fv->addWidget(labeledRow("Description", m_desc, 68, 6)); fv->addSpacing(7);
    fh->addWidget(form, 1);
    auto* side = new QWidget; side->setFixedWidth(68); auto* sv = vbox(side, 6); sv->setAlignment(Qt::AlignCenter);
    auto* top = new QWidget; top->setFixedSize(68, 39);
    m_iconLbl = new QLabel(top); m_iconLbl->setGeometry(18, 7, 32, 32);
    m_copy = new CopyBtn(22, 15, top); m_copy->move(40, 0);
    sv->addWidget(top, 0, Qt::AlignHCenter);
    m_sizeLbl = makeLabel("", 13, 650, "accent"); m_sizeLbl->setAlignment(Qt::AlignCenter); sv->addWidget(m_sizeLbl);
    m_durLbl = makeLabel("", 11, 400, "t2"); m_durLbl->setAlignment(Qt::AlignCenter); sv->addWidget(m_durLbl);
    sv->addSpacing(7);
    fh->addWidget(side);
    bv->addWidget(fi);
    // queue panel (hidden)
    m_queuePanel = new QWidget; auto* qv = vbox(m_queuePanel, 0, QMargins(0, 0, 0, 14)); m_queuePanel->hide();
    auto* ql = makeLabel("Main queue", 11, 500, "t2"); qv->addWidget(ql); qv->addSpacing(4);
    auto* qp = makeLabel("Add this file to the main queue and start it later.", 12, 400, "muted"); qv->addWidget(qp); qv->addSpacing(8);
    auto* qa = new QWidget; auto* qh = hbox(qa, 8); qh->addStretch(1);
    auto* qback = new PushButton(PushButton::Secondary, "Back"); auto* qyes = new PushButton(PushButton::Primary, "Add to queue");
    qh->addWidget(qback); qh->addWidget(qyes); qv->addWidget(qa);
    bv->addWidget(m_queuePanel);
    pv->addWidget(bodyW);
    // footer: .dialog-footer.file-info-footer  (156x30, radius 6, 600)
    m_footAdd = new QWidget; auto* ft = hbox(m_footAdd, 8, QMargins(16, 8, 16, 12)); ft->setAlignment(Qt::AlignHCenter);
    auto mkBtn = [&](PushButton::Kind k, const QString& t) { auto* x = new PushButton(k, t); x->metrics(8, 5, 6, 600).fixed(156, 30); return x; };
    auto* later = mkBtn(PushButton::Secondary, "Download later"); auto* start = mkBtn(PushButton::Primary, "Start Download"); auto* cancel = mkBtn(PushButton::Secondary, "Cancel");
    ft->addStretch(1); ft->addWidget(later); ft->addWidget(start); ft->addWidget(cancel); ft->addStretch(1);
    pv->addWidget(m_footAdd);
    root->addWidget(m_pageAdd);

    // ------------------------------------------------ page: duplicate
    m_pageDup = new QWidget; auto* dv = vbox(m_pageDup, 0); m_pageDup->hide();
    auto* db = new QWidget; auto* dbv = vbox(db, 0, QMargins(16, 4, 16, 6));
    dbv->addSpacing(2); m_dupName = makeLabel("", 13, 650, "accent"); m_dupName->setWordWrap(true); dbv->addWidget(m_dupName); dbv->addSpacing(10);
    m_dupGroup = new QButtonGroup(this);
    auto* c1 = new DupChoice("Save another copy", "Keep the current download and add a number to the new file name.", "number", m_dupGroup, db);
    auto* c2 = new DupChoice("Replace the existing file", "Remove the one in the list and start this download in its place.", "replace", m_dupGroup, db);
    auto* c3 = new DupChoice("Use the download already here", "If it finished, open the finished-file sheet. If it did not, continue it.", "resume", m_dupGroup, db);
    c3->radio->setChecked(true);
    dbv->addWidget(c1); dbv->addSpacing(6); dbv->addWidget(c2); dbv->addSpacing(6); dbv->addWidget(c3); dbv->addSpacing(8);
    m_dupRemember = new ChkBox("Remember this choice. Change it later in Preferences, under Behavior.");
    dbv->addWidget(m_dupRemember); dbv->addSpacing(2);
    dv->addWidget(db);
    auto* dft = new QWidget; auto* dfv = vbox(dft, 0); dfv->addWidget(hsep("1"));
    auto* dfr = new QWidget; auto* dfh = hbox(dfr, 8, QMargins(16, 8, 16, 12)); dfh->addStretch(1);
    auto* dskip = mkBtn(PushButton::Secondary, "Cancel"); auto* dok = mkBtn(PushButton::Primary, "OK");
    dfh->addWidget(dskip); dfh->addWidget(dok); dfv->addWidget(dfr); dv->addWidget(dft);
    root->addWidget(m_pageDup);

    // ------------------------------------------------ init (port of init())
    m_meta = data.value("meta").toObject();
    if (m_meta.isEmpty()) {
        m_meta = QJsonObject{{"headers", data.value("headers")}, {"referrer", data.value("referrer")}, {"cookies", data.value("cookies")}, {"audioUrl", data.value("audioUrl")},
                             {"sourcePage", data.value("sourcePage")}, {"formatId", data.value("formatId")}, {"audioFormatId", data.value("audioFormatId")}};
    }
    for (const char* k : {"login", "password", "confirmId", "catchToken"}) if (m_meta.value(k).toString().isEmpty()) m_meta[k] = data.value(k);
    for (const char* k : {"browserPull", "exactHeaders", "audioOnly"}) m_meta[k] = data.value(k).toBool() || m_meta.value(k).toBool();
    m_meta["audioSize"] = data.value("audioSize").toDouble(m_meta.value("audioSize").toDouble());
    m_manual = data.value("manual").toBool();
    m_url = data.value("url").toString();
    auto usable = [](QString n) { n = n.section(QRegularExpression("[/\\\\]"), -1).remove(QRegularExpression("\\.crdownload$", QRegularExpression::CaseInsensitiveOption)); n.replace(QRegularExpression("[<>:\"/\\\\|?*]+"), " "); n = n.simplified(); return n.startsWith("unconfirmed", Qt::CaseInsensitive) ? QString() : n; };
    QString picked = usable(data.value("fileName").toString());
    if (picked.isEmpty()) { const QString u = QUrl::fromPercentEncoding(QUrl(m_url).path().section('/', -1).toUtf8()); picked = usable(u); if (picked.size() > 180) picked.clear(); }
    m_size = qint64(data.value("size").toDouble());
    m_name->setText(picked);
    m_dur = data.value("duration").toDouble();
    applyKind(data.value("fileName").toString(), m_url, m_size);
    const double ab = data.value("audioSize").toDouble();
    if (ab > 0) m_sizeLbl->setText(fmtSize(m_size + ab));
    if (m_dur > 0) m_durLbl->setText(fmtDuration(m_dur));
    m_remember->setChecked(m_settings.value("library").toObject().value("rememberLastFolder").toBool(true));
    paintRemember(); paintIcon();
    m_dupGroup->buttons().at(2)->setChecked(true);

    // ------------------------------------------------ wiring
    connect(m_kind, &QComboBox::currentIndexChanged, this, [this] { m_userPath = false; const QString f = folderFor(m_kind->currentData().toString()); if (!f.isEmpty()) m_path->setText(f); paintRemember(); });
    connect(m_name, &QLineEdit::editingFinished, this, [this] { applyKind(m_name->text(), m_url, m_size); paintIcon(); });
    connect(browse, &QAbstractButton::clicked, this, [this] { const QString f = m_b->invoke("settings:pick-folder").toString(); if (f.isEmpty()) return; m_userPath = true; m_path->setText(f); });
    connect(m_copy, &QAbstractButton::clicked, this, [this] { copyText(m_url, m_copy); });
    connect(start, &QAbstractButton::clicked, this, [this] { submit(); });
    connect(later, &QAbstractButton::clicked, this, [this] { parkLater(); });
    connect(qback, &QAbstractButton::clicked, this, [this] { m_queuePanel->hide(); m_footAdd->show(); fit(); });
    connect(qyes, &QAbstractButton::clicked, this, [this] { submit(QJsonObject{{"queueOnly", true}}); });
    connect(cancel, &QAbstractButton::clicked, this, [this] { m_closed = true; abandon(); close(); });
    connect(dskip, &QAbstractButton::clicked, this, [this] { abandon(); close(); });
    connect(dok, &QAbstractButton::clicked, this, [this] {
        QString act = "resume"; for (auto* b2 : m_dupGroup->buttons()) if (b2->isChecked()) act = b2->property("key").toString();
        if (m_dupRemember->isChecked()) m_b->invoke("settings:update", QJsonObject{{"behavior", QJsonObject{{"duplicateAction", act}}}});
        submit(QJsonObject{{"duplicateConfirmed", act}});
    });
    auto* enter = new QShortcut(QKeySequence(Qt::Key_Return), this);
    connect(enter, &QShortcut::activated, this, [this, start, dok] { if (m_pageDup->isVisible()) dok->click(); else if (!m_queuePanel->isVisible()) start->click(); });
    fit();
}

QString AddDialog::folderFor(const QString& kind) const {
    const QJsonObject lib = m_settings.value("library").toObject();
    const QString f = lib.value("folders").toObject().value(kind).toString();
    return f.isEmpty() ? lib.value("defaultPath").toString() : f;
}
static QString patternHost(QString raw) {
    raw = raw.trimmed().toLower(); raw.remove(QRegularExpression("^[a-z][a-z0-9+.-]*://"));
    raw = raw.section(QRegularExpression("[/?#]"), 0, 0); raw.remove(QRegularExpression(":\\d+$")); raw.remove(QRegularExpression("^\\*\\."));
    raw.remove(QRegularExpression("^www\\.")); return raw;
}
QString AddDialog::classify(const QString& fileName, const QString& url) const {
    const QJsonObject patterns = m_settings.value("categories").toObject().value("patterns").toObject();
    QString host = QUrl(url).host().toLower(); host.remove(QRegularExpression("^www\\."));
    if (!host.isEmpty() && !patterns.isEmpty())
        for (const char* kind : {"video", "music", "programs", "compressed", "documents", "images"})
            for (const auto& pv : patterns.value(kind).toArray()) { const QString n = patternHost(pv.toString()); if (!n.isEmpty() && (host == n || host.endsWith("." + n))) return kind; }
    static const QVector<QPair<QString, QStringList>> exts = {
        {"compressed", {"zip", "rar", "7z", "tar", "gz", "bz2", "iso", "xz"}}, {"documents", {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt"}},
        {"music", {"mp3", "flac", "wav", "aac", "ogg", "wma", "m4a"}}, {"programs", {"exe", "msi", "dmg", "deb", "rpm", "apk"}},
        {"video", {"mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m3u8", "ts", "ogv"}}, {"images", {"jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"}}};
    const QString clean = (fileName.isEmpty() ? url : fileName).section('?', 0, 0);
    const QRegularExpressionMatch m = QRegularExpression("\\.([a-z0-9]+)$", QRegularExpression::CaseInsensitiveOption).match(clean);
    if (m.hasMatch()) for (const auto& e : exts) if (e.second.contains(m.captured(1).toLower())) return e.first;
    if (QRegularExpression("youtube\\.com|youtu\\.be|vimeo\\.com|tiktok\\.com|instagram\\.com|dailymotion\\.com").match((fileName + " " + url).toLower()).hasMatch()) return "video";
    return "general";
}
void AddDialog::applyKind(const QString& fileName, const QString& url, qint64 size) {
    if (size) m_size = size;
    const QString kind = classify(fileName, url);
    const int i = m_kind->findData(kind); if (i >= 0) { QSignalBlocker sb(m_kind); m_kind->setCurrentIndex(i); }
    if (!m_userPath) { const QString f = folderFor(kind); if (!f.isEmpty()) m_path->setText(f); }
    m_sizeLbl->setText(size ? fmtSize(double(size)) : QString());
    paintRemember(); paintIcon();
}
void AddDialog::paintRemember() { m_remember->setText("Remember this folder for " + m_kind->currentText()); m_remember->updateGeometry(); }
void AddDialog::paintIcon() { m_iconLbl->setPixmap(Theme::fileIcon(m_name->text().isEmpty() ? "file.bin" : m_name->text(), 32)); }
void AddDialog::fit() {
    QTimer::singleShot(0, this, [this] {
        const bool dup = m_pageDup->isVisible();
        QWidget* pg = dup ? m_pageDup : m_pageAdd; pg->layout()->activate();
        int h = spec().h + pg->sizeHint().height(); if (dup) h = qMax(h, 180);
        setFixedSize(dup ? 500 : 520, h);
    });
}
void AddDialog::abandon() { const QString id = m_meta.value("confirmId").toString(); if (!id.isEmpty()) { m_b->send("download:confirm-cancel", id); m_meta["confirmId"] = ""; } }
void AddDialog::closeEvent(QCloseEvent* e) { abandon(); FramelessWindow::closeEvent(e); }

void AddDialog::parkLater() {
    if (!m_armedId.isEmpty()) { m_b->send("download:pause", m_armedId); close(); return; }
    if (m_settings.value("behavior").toObject().value("queueOnLater").toBool(true)) { m_queuePanel->show(); m_footAdd->hide(); fit(); return; }
    submit(QJsonObject{{"queueOnly", true}});
}
void AddDialog::submit(const QJsonObject& extra) {
    if (m_url.isEmpty()) return;
    QJsonObject o = m_opts;
    if (o.isEmpty()) {
        const QString ref = m_meta.value("referrer").toString();
        const QString audioUrl = m_meta.value("audioUrl").toString();
        QString site; { const QUrl u(m_url); if (u.scheme() == "http" || u.scheme() == "https" || u.scheme() == "ftp") site = u.scheme() + "://" + u.authority() + "/"; }
        o = QJsonObject{{"url", m_url}, {"audioUrl", audioUrl.isEmpty() ? QJsonValue(QJsonValue::Null) : QJsonValue(audioUrl)}, {"needsMux", !audioUrl.isEmpty()},
            {"savePath", m_path->text().trimmed()}, {"fileName", m_name->text().trimmed()}, {"category", m_kind->currentData().toString()},
            {"headers", m_meta.value("headers")}, {"referrer", ref.isEmpty() ? site : ref}, {"login", m_meta.value("login")}, {"password", m_meta.value("password")},
            {"cookies", m_meta.value("cookies")}, {"manual", m_manual}, {"sourcePage", m_meta.value("sourcePage")}, {"formatId", m_meta.value("formatId")},
            {"audioFormatId", m_meta.value("audioFormatId")}, {"confirmId", m_meta.value("confirmId")}, {"browserPull", m_meta.value("browserPull")},
            {"audioOnly", m_meta.value("audioOnly").toBool() || extra.value("audioOnly").toBool()}, {"audioSize", m_meta.value("audioSize")},
            {"catchToken", m_meta.value("catchToken")}, {"exactHeaders", m_meta.value("exactHeaders")}, {"description", m_desc->text().trimmed()},
            {"rememberPath", m_remember->isChecked()}, {"fileSize", double(m_size)}, {"size", double(m_size)}, {"duration", m_dur}};
    }
    for (auto it = extra.begin(); it != extra.end(); ++it) o[it.key()] = it.value();
    o["manual"] = m_manual; o["fromDialog"] = true;
    const QJsonObject rec = m_b->invoke("download:add", o).toObject();
    if (rec.value("duplicate").toBool()) { m_opts = o; showDuplicate(rec); return; }
    close();
}
void AddDialog::showDuplicate(const QJsonObject& rec) {
    const QJsonObject ex = rec.value("existing").toObject();
    m_dupName->setText(ex.value("fileName").toString(ex.value("url").toString(m_url)));
    m_dupGroup->buttons().at(2)->setChecked(true); m_dupRemember->setChecked(false);
    setTitle([] { TitleSpec s; s.h = 34; s.caption = "This file is already in your list."; s.barClear = true; s.border = false; s.winBg = TitleSpec::Card; s.capWeight = 600; s.capPad = 16; return s; }());
    m_pageAdd->hide(); m_pageDup->show(); fit();
}

// =================================================================== AddressDialog
class AddressHistory : public QWidget {
    Q_OBJECT
public:
    AddressHistory(const QStringList& urls, int w, QWidget* p) : QWidget(p, Qt::Popup | Qt::FramelessWindowHint), m_urls(urls) {
        setAttribute(Qt::WA_DeleteOnClose); setMouseTracking(true);
        setFixedSize(w, qMin(int(urls.size()) * 28, 8 * 28) + 2);
    }
signals:
    void picked(const QString& url);
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(this);
        p.fillRect(rect(), t.card); p.setPen(t.border2); p.drawRect(rect().adjusted(0, 0, -1, -1));
        p.setFont(Theme::uiFont(12));
        for (int i = 0; i < m_urls.size() && i < 8; ++i) {
            const QRect r(1, 1 + i * 28, width() - 2, 28);
            if (i == m_hover) p.fillRect(r, t.hover);
            p.setPen(t.t1); p.drawText(r.adjusted(8, 0, -8, 0), Qt::AlignVCenter, QFontMetrics(p.font()).elidedText(m_urls[i], Qt::ElideRight, r.width() - 16));
        }
    }
    void mouseMoveEvent(QMouseEvent* e) override { const int h = (e->pos().y() - 1) / 28; if (h != m_hover) { m_hover = h; update(); } }
    void mouseReleaseEvent(QMouseEvent* e) override { const int i = (e->pos().y() - 1) / 28; if (i >= 0 && i < m_urls.size()) emit picked(m_urls[i]); close(); }
    void keyPressEvent(QKeyEvent* e) override { if (e->key() == Qt::Key_Escape) close(); }
private:
    QStringList m_urls; int m_hover = -1;
};

static TitleSpec popupSpec(const QString& cap) { TitleSpec s; s.h = 32; s.caption = cap; s.border = true; s.buttons = 1; return s; }

AddressDialog::AddressDialog(Bridge* b) : FramelessWindow(popupSpec("Enter new address to download"), false, true), m_b(b) {
    setFixedWidth(620);
    auto* sheet = new QWidget; auto* sv = vbox(sheet, 10, QMargins(14, 14, 14, 12)); sv->setAlignment(Qt::AlignTop);
    auto* r1 = new QWidget; auto* h1 = hbox(r1, 8); h1->setAlignment(Qt::AlignTop);
    auto* lab = makeLabel("Address", 12, 400, "t1"); lab->setFixedWidth(62); lab->setContentsMargins(0, 5, 0, 0); h1->addWidget(lab, 0, Qt::AlignTop);
    auto* combo = new QWidget; combo->setFixedHeight(26); auto* ch = hbox(combo, 0);
    m_addr = makeEdit("addr", combo); m_addr->setTextMargins(0, 0, 14, 0); m_addr->setFixedHeight(26); m_addr->setAttribute(Qt::WA_MacShowFocusRect, false); ch->addWidget(m_addr);
    auto* hb = new GlyphBtn(QString::fromUtf8("\xE2\x96\xBE"), 10, combo); hb->setGeometry(0, 1, 20, 24);
    h1->addWidget(combo, 1);
    auto* side = new QWidget; side->setFixedWidth(84); auto* sdv = vbox(side, 6);
    auto mk = [&](const QString& t, bool acc) { auto* x = new PushButton(PushButton::Win, t); x->metrics(8, 4, 3, 400).fixed(84, 26); x->accentBorder(acc); return x; };
    auto* ok = mk("OK", true); auto* cancel = mk("Cancel", false); sdv->addWidget(ok); sdv->addWidget(cancel);
    h1->addWidget(side, 0, Qt::AlignTop);
    sv->addWidget(r1);
    auto* line = hsep("2"); sv->addSpacing(2); sv->addWidget(line);
    auto* ar = new QWidget; auto* ah = hbox(ar, 14);
    m_auth = new ChkBox("Use authorization"); ah->addWidget(m_auth);
    auto field = [&](const QString& t, bool pw) { auto* w = new QWidget; auto* h = hbox(w, 6); h->addWidget(makeLabel(t, 12, 400, "t2")); auto* e = makeEdit("auth"); e->setFixedHeight(24); e->setEnabled(false); if (pw) e->setEchoMode(QLineEdit::Password); h->addWidget(e, 1); ah->addWidget(w, 1); return e; };
    m_login = field("Login", false); m_pass = field("Password", true);
    sv->addWidget(ar);
    m_err = makeLabel("", 11, 400, "danger"); m_err->setMinimumHeight(14); sv->addWidget(m_err);
    auto* v = vbox(body(), 0); v->addWidget(sheet);
    // history
    try { for (const auto& x : b->invoke("app:get-address-history").toArray()) m_hist << x.toString(); } catch (...) {}
    connect(hb, &QAbstractButton::clicked, this, [this, combo] {
        if (m_hist.isEmpty()) return;
        auto* pop = new AddressHistory(m_hist, m_addr->width(), this);
        connect(pop, &AddressHistory::picked, this, [this](const QString& u) { fill(u); });
        pop->move(m_addr->mapToGlobal(QPoint(0, m_addr->height()))); pop->show();
        Q_UNUSED(combo)
    });
    connect(m_auth, &QCheckBox::toggled, this, [this](bool on) { m_login->setEnabled(on); m_pass->setEnabled(on); if (on) m_login->setFocus(); });
    connect(ok, &QAbstractButton::clicked, this, [this] { confirm(); });
    connect(cancel, &QAbstractButton::clicked, this, [this] { close(); });
    auto* esc = new QShortcut(QKeySequence(Qt::Key_Escape), this); connect(esc, &QShortcut::activated, this, [this] { close(); });
    auto* ent = new QShortcut(QKeySequence(Qt::Key_Return), this); connect(ent, &QShortcut::activated, this, [this] { confirm(); });
    const QString pre = b->invoke("app:get-address-prefill").toString(); if (!pre.isEmpty()) fill(pre);
    m_addr->setFocus();
    sheet->layout()->activate(); setFixedHeight(32 + sheet->sizeHint().height());
}
void AddressDialog::fill(const QString& url) { if (url.isEmpty()) return; m_addr->setText(url); m_addr->setFocus(); m_addr->selectAll(); }
void AddressDialog::confirm() {
    if (m_busy) return;
    m_err->setText("");
    const QString url = m_addr->text().trimmed();
    if (url.isEmpty()) { m_err->setText("Enter an address."); m_addr->setFocus(); return; }
    m_busy = true;
    const bool ua = m_auth->isChecked();
    const QJsonObject r = m_b->invoke("window:confirm-address", QJsonObject{{"url", url}, {"useAuth", ua}, {"login", ua ? m_login->text() : QString()}, {"password", ua ? m_pass->text() : QString()}}).toObject();
    if (!r.isEmpty() && r.contains("ok") && !r.value("ok").toBool()) { m_busy = false; m_err->setText(r.value("error").toString("Enter a valid address.")); m_addr->setFocus(); return; }
    close();
}

// =================================================================== CompleteDialog
CompleteDialog::CompleteDialog(Bridge* b, const QJsonObject& data) : FramelessWindow([] { TitleSpec s; s.h = 28; s.barClear = true; s.border = false; s.winBg = TitleSpec::Card; return s; }(), false, false) {
    setFixedWidth(520);
    const QString path = data.value("path").toString(), url = data.value("url").toString();
    const QString name = data.value("fileName").toString(QFileInfo(path).fileName().isEmpty() ? "File" : QFileInfo(path).fileName());
    const double size = data.value("size").toDouble();
    auto* v = vbox(body(), 0);
    auto* bd = new QWidget; auto* bv = vbox(bd, 0, QMargins(16, 12, 16, 6));
    auto* head = new QWidget; auto* hh = hbox(head, 12);
    auto* icon = new QLabel; icon->setFixedSize(36, 36); icon->setPixmap(Theme::fileIcon(name, 36)); icon->setScaledContents(false); hh->addWidget(icon, 0, Qt::AlignVCenter);
    auto* col = new QWidget; auto* cv = vbox(col, 2);
    auto* tr = new QWidget; auto* th = hbox(tr, 8); th->setAlignment(Qt::AlignTop);
    auto* title = makeLabel(name, 13, 650, "t1"); title->setWordWrap(true); title->setToolTip(name); th->addWidget(title, 1);
    auto* cp = new CopyBtn(22, 14); th->addWidget(cp, 0, Qt::AlignTop);
    cv->addWidget(tr);
    auto* lead = makeLabel(size > 0 ? QString("Downloaded %1 (%2 Bytes)").arg(fmtSize(size)).arg(QLocale().toString(qint64(size))) : "The file is ready.", 11, 400, "t2"); cv->addWidget(lead);
    hh->addWidget(col, 1);
    bv->addWidget(head); bv->addSpacing(8);
    bv->addWidget(makeLabel("Save as", 12, 400, "t2")); bv->addSpacing(4);
    auto* pe = makeEdit("info", nullptr, true); pe->setFixedHeight(28); pe->setLayoutDirection(Qt::LeftToRight); pe->setText(path); pe->setCursorPosition(0); bv->addWidget(pe); bv->addSpacing(8);
    auto* tg = new ToggleRow(QString::fromUtf8("Don\xE2\x80\x99t show this again"), 12, 3); bv->addWidget(tg);
    v->addWidget(bd);
    auto* ft = new QWidget; auto* fv = vbox(ft, 0); fv->addWidget(hsep("1"));
    auto* fr = new QWidget; auto* fh = hbox(fr, 8, QMargins(16, 8, 16, 12));
    auto mk = [&](PushButton::Kind k, const QString& t) { auto* x = new PushButton(k, t); x->metrics(8, 5, 6, 600); x->setMinimumHeight(30); x->setMaximumHeight(30); x->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed); return x; };
    auto* bc = mk(PushButton::Secondary, "Close"); auto* bf = mk(PushButton::Secondary, "Open folder"); auto* bo = mk(PushButton::Primary, "Open");
    fh->addWidget(bc, 1); fh->addWidget(bf, 1); fh->addWidget(bo, 1); fv->addWidget(fr); v->addWidget(ft);
    auto closeSheet = [this, b, tg] { if (tg->toggle()->isChecked()) b->invoke("settings:update", QJsonObject{{"behavior", QJsonObject{{"showCompleteDialog", false}}}}); close(); };
    connect(bo, &QAbstractButton::clicked, this, [=] { if (!path.isEmpty()) b->send("download:open-file", path); closeSheet(); });
    connect(bf, &QAbstractButton::clicked, this, [=] { if (!path.isEmpty()) b->send("download:open-folder", path); });
    connect(bc, &QAbstractButton::clicked, this, closeSheet);
    connect(cp, &QAbstractButton::clicked, this, [=] { copyText(url, cp); });
    layout()->activate(); setFixedHeight(28 + bd->sizeHint().height() + ft->sizeHint().height());
}

// =================================================================== PropertiesDialog
PropertiesDialog::PropertiesDialog(Bridge* b, const QJsonObject& d) : FramelessWindow(popupSpec("File Properties"), false, true) {
    setFixedSize(480, 600);
    auto* v = vbox(body(), 0, QMargins(16, 16, 16, 16));
    auto* head = new QWidget; auto* hh = hbox(head, 16, QMargins(0, 0, 0, 12));
    auto* ico = new QLabel; ico->setFixedSize(48, 48); ico->setAlignment(Qt::AlignCenter);
    ico->setPixmap(Theme::fileIcon(d.value("path").toString().isEmpty() ? d.value("fileName").toString("file.bin") : d.value("path").toString(), 40));
    hh->addWidget(ico);
    auto* nm = makeLabel(d.value("fileName").toString("Unknown"), 14, 600, "t1"); nm->setWordWrap(true); hh->addWidget(nm, 1);
    v->addWidget(head); v->addWidget(hsep("1")); v->addSpacing(12);
    auto rowOf = [&](const QString& l, QWidget* w, QWidget* extra = nullptr) {
        auto* r = new QWidget; auto* h = hbox(r, 8); auto* lb = makeLabel(l, 12, 400, "t2"); lb->setFixedWidth(80 - (extra ? 0 : 0)); h->addWidget(lb); h->addWidget(w, 1); if (extra) h->addWidget(extra);
        v->addWidget(r); v->addSpacing(8); return r;
    };
    auto val = [&](const QString& t) { return makeLabel(t, 12, 500, "t1"); };
    const QString fn = d.value("fileName").toString(); const QString ext = fn.section('.', -1).toUpper();
    rowOf("Type:", val(fn.contains('.') && !ext.isEmpty() ? ext + " File" : "Unknown File"));
    rowOf("Status:", val(d.value("status").toString("Unknown")));
    const double dur = d.value("duration").toDouble();
    const double total = d.value("fileSize").toDouble() > 0 ? d.value("fileSize").toDouble() : d.value("progress").toObject().value("total").toDouble();
    rowOf(dur > 0 ? "Duration:" : "Size:", val(dur > 0 ? fmtDuration(dur) : (total > 0 ? fmtSize(total, 2) + QString(" (%1 Bytes)").arg(QLocale().toString(qint64(total))) : "0 Bytes")));
    auto* path = makeEdit("prop", nullptr, true); path->setText(d.value("path").toString());
    auto* od = new PushButton(PushButton::Secondary, "Open Dir"); od->metrics(12, 4, 4, 500);
    rowOf("Save To:", path, od);
    auto ro = [&](const QString& l, const QString& t) { auto* e = makeEdit("prop", nullptr, true); e->setText(t); return rowOf(l, e); };
    ro("Address:", d.value("url").toString()); ro("Description:", d.value("description").toString());
    if (d.value("status").toString() == "error" && !d.value("error").toString().isEmpty()) {
        const QString et = d.value("errorTitle").toString();
        auto* pl = val(et.isEmpty() ? d.value("error").toString() : et + ". " + d.value("error").toString()); pl->setWordWrap(true); rowOf("Problem:", pl);
    }
    v->addSpacing(8); v->addWidget(hsep("1")); v->addSpacing(12);
    auto* title = makeLabel("NETWORK DETAILS", 11, 600, "muted"); v->addWidget(title); v->addSpacing(8);
    const QJsonObject hd = d.value("headers").toObject();
    QString referer = d.value("referrer").toString(hd.value("Referer").toString(hd.value("referer").toString()));
    if (referer.isEmpty()) { const QUrl u(d.value("url").toString()); if (u.scheme() == "http" || u.scheme() == "https" || u.scheme() == "ftp") referer = u.scheme() + "://" + u.authority() + "/"; }
    QString login = d.value("login").toString(), pass = d.value("password").toString();
    const QString auth = hd.value("Authorization").toString(hd.value("authorization").toString());
    if (login.isEmpty() && auth.startsWith("Basic ", Qt::CaseInsensitive)) { const QString dec = QString::fromUtf8(QByteArray::fromBase64(auth.mid(6).toUtf8())); const int i = dec.indexOf(':'); login = i < 0 ? dec : dec.left(i); if (pass.isEmpty() && i >= 0) pass = dec.mid(i + 1); }
    ro("Referer:", referer); ro("Login:", login); ro("Password:", pass);
    v->addStretch(1);
    auto* fr = new QWidget; auto* fh = hbox(fr, 8); fh->addStretch(1);
    auto* open = new PushButton(PushButton::Primary, "Open"); auto* ok = new PushButton(PushButton::Secondary, "OK"); fh->addWidget(open); fh->addWidget(ok); v->addWidget(fr);
    const QString fp = d.value("path").toString();
    connect(od, &QAbstractButton::clicked, this, [=] { if (!fp.isEmpty()) b->send("download:open-folder", fp); });
    connect(open, &QAbstractButton::clicked, this, [=] { if (!fp.isEmpty()) { b->send("download:open-file", fp); close(); } });
    connect(ok, &QAbstractButton::clicked, this, [this] { close(); });
}

// =================================================================== refresh dialogs
RefreshAsk::RefreshAsk(Bridge* b, const QString& id, const QString& name) : FramelessWindow(popupSpec(name), false, true) {
    setFixedWidth(480);
    auto* v = vbox(body(), 12, QMargins(16, 16, 16, 14));
    auto lead = [&](const QString& t) { auto* l = makeLabel(t, 13, 400, "t2"); l->setWordWrap(true); return l; };
    v->addWidget(lead("Cannot resume downloading the file:"));
    auto* n = makeLabel(name, 13, 600, "t1"); n->setWordWrap(true); v->addWidget(n);
    v->addWidget(lead("The address may no longer be valid, or the session has expired. ZDM will open the page where this download was captured. Start the same file from your browser again, and ZDM will catch the new address and continue this download."));
    auto* a = new QWidget; auto* ah = hbox(a, 8); ah->addStretch(1);
    auto* ok = new PushButton(PushButton::Primary, "OK"); auto* cancel = new PushButton(PushButton::Secondary, "Cancel"); ah->addWidget(ok); ah->addWidget(cancel); v->addWidget(a);
    connect(ok, &QAbstractButton::clicked, this, [=] { b->send("refresh:accept", id); close(); });
    connect(cancel, &QAbstractButton::clicked, this, [=] { b->send("refresh:decline", id); close(); });
    layout()->activate(); setFixedHeight(32 + body()->sizeHint().height());
}
RefreshWait::RefreshWait(Bridge* b, const QString& name) : FramelessWindow(popupSpec("Waiting for a new address"), false, true) {
    setFixedWidth(440);
    auto* v = vbox(body(), 12, QMargins(18, 18, 18, 14));
    auto* l = makeLabel("ZDM is waiting for a new address to resume:", 13, 400, "t2"); l->setWordWrap(true); v->addWidget(l);
    auto* n = makeLabel(name, 13, 600, "t1"); n->setWordWrap(true); v->addWidget(n);
    auto* a = new QWidget; auto* ah = hbox(a, 0); ah->addStretch(1);
    auto* stop = new PushButton(PushButton::Secondary, "Stop waiting"); ah->addWidget(stop); v->addWidget(a);
    connect(stop, &QAbstractButton::clicked, this, [=] { b->send("refresh:stop"); close(); });
    layout()->activate(); setFixedHeight(32 + body()->sizeHint().height());
}

// =================================================================== WindowManager
WindowManager::WindowManager(Store* s, QueueEngine* q, QObject* parent) : QObject(parent), m_s(s), m_q(q) {
    connect(s->bridge(), &Bridge::openWindow, this, &WindowManager::open);
}
void WindowManager::open(const QString& name, const QJsonValue& arg) {
    Bridge* b = m_s->bridge();
    auto unique = [&](const QString& key, std::function<QWidget*()> make) {
        if (QWidget* w = m_open.value(key)) { bringToFront(w); return w; }
        QWidget* w = make(); m_open[key] = w; showWin(w); return w;
    };
    if (name == "address") unique("address", [&] { return new AddressDialog(b); });
    else if (name == "add") showWin(new AddDialog(b, arg.toObject()));
    else if (name == "complete") showWin(new CompleteDialog(b, arg.toObject()));
    else if (name == "properties") showWin(new PropertiesDialog(b, arg.toObject()));
    else if (name == "progress") { const QString id = arg.isObject() ? arg.toObject().value("id").toString() : arg.toString(); unique("progress:" + id, [&] { return new ProgressDialog(m_s, id); }); }
    else if (name == "playlist") unique("playlist", [&] { return new PlaylistDialog(b, arg.toString()); });
    else if (name == "settings") unique("settings", [&] { return new SettingsDialog(m_s); });
    else if (name == "extension-setup") unique("extension-setup", [&] { return new ExtensionSetup(m_s); });
    else if (name == "scheduler") {
        auto* w = static_cast<SchedulerDialog*>(unique("scheduler", [&] { return new SchedulerDialog(m_q, m_s); }));
        const QJsonObject o = arg.toObject(); w->navigate(o.value("queueId").toString(), o.value("tab").toString());
    }
    else if (name == "refresh-ask") { const QJsonObject o = arg.toObject(); showWin(new RefreshAsk(b, o.value("id").toString(), o.value("name").toString("this file"))); }
    else if (name == "refresh-wait") showWin(new RefreshWait(b, arg.toString("this file")));
}

#include "Dialogs.moc"
