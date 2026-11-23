#include "Dialogs.h"
#include "ExtensionPanel.h"
#include "zdm_str.hpp"
#include <cmath>

namespace {
// ---------------------------------------------------------------- JSON path helpers (getPath / setPath of settings.js)
QJsonValue getPath(const QJsonObject& o, const QString& path) {
    QJsonValue cur = o;
    for (const QString& k : path.split('.')) { if (!cur.isObject()) return QJsonValue(QJsonValue::Undefined); cur = cur.toObject().value(k); }
    return cur;
}
QJsonObject setRec(QJsonObject o, const QStringList& keys, int i, const QJsonValue& v) {
    if (i == keys.size() - 1) { o[keys[i]] = v; return o; }
    QJsonObject child = o.value(keys[i]).toObject(); o[keys[i]] = setRec(child, keys, i + 1, v); return o;
}
QJsonObject setPath(const QJsonObject& o, const QString& path, const QJsonValue& v) { return setRec(o, path.split('.'), 0, v); }

// ---------------------------------------------------------------- widgets
class NavItem : public QAbstractButton {              // .settings-nav-item
public:
    NavItem(const QString& t, QWidget* p) : QAbstractButton(p) { setText(t); setCheckable(true); setAttribute(Qt::WA_Hover); setCursor(Qt::PointingHandCursor); setFocusPolicy(Qt::NoFocus); }
    QSize sizeHint() const override { return {100, 9 + QFontMetrics(Theme::uiFont(13, 500)).lineSpacing() + 9}; }
protected:
    void paintEvent(QPaintEvent*) override {
        const Theme& th = Theme::I(); const Tokens& t = th.t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        if (isChecked()) th.paintNavActive(&p, QRectF(rect()), 4);
        else if (underMouse()) { QPainterPath pp; pp.addRoundedRect(QRectF(rect()), 4, 4); p.fillPath(pp, t.hover); }
        p.setFont(Theme::uiFont(13, 500)); p.setPen(isChecked() ? t.navFg : underMouse() ? t.t1 : t.t2);
        p.drawText(QRect(12, 0, width() - 24, height()), Qt::AlignVCenter, text());
    }
};
class Nav : public QWidget {
public:
    Nav(QWidget* p) : QWidget(p) { setFixedWidth(176); }
protected:
    void paintEvent(QPaintEvent*) override { QPainter p(this); const Tokens& t = Theme::I().t(); p.fillRect(rect(), t.bg1); p.fillRect(QRect(width() - 1, 0, 1, height()), t.border); }
};
class CardW : public QWidget {                        // .settings-card (bg card, 1px border, radius 8, padding 16px 18px)
public:
    QVBoxLayout* v;
    CardW(const QString& title, QWidget* p) : QWidget(p) {
        v = vbox(this, 0, QMargins(18, 16, 18, 16));
        auto* g = new GradLabel(title, 13, 600, this); v->addWidget(g); v->addSpacing(10);
        connect(&Theme::I(), &Theme::changed, this, [this] { update(); });
    }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        QPainterPath o; o.addRoundedRect(QRectF(rect()), 8, 8); p.fillPath(o, t.border);
        QPainterPath i; i.addRoundedRect(QRectF(rect()).adjusted(1, 1, -1, -1), 7, 7); p.fillPath(i, t.card);
    }
};
class BoxRow : public QWidget {                        // .browser-row
public:
    BoxRow(QWidget* p) : QWidget(p) { setAttribute(Qt::WA_Hover); }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        QPainterPath o; o.addRoundedRect(QRectF(rect()), 4, 4); p.fillPath(o, underMouse() ? t.border2 : t.border);
        QPainterPath i; i.addRoundedRect(QRectF(rect()).adjusted(1, 1, -1, -1), 3, 3); p.fillPath(i, t.bg1);
    }
};
class StatusDot : public QWidget {                     // .browser-status-connected
public:
    StatusDot(QWidget* p) : QWidget(p) { setFixedHeight(18); setFixedWidth(QFontMetrics(Theme::uiFont(12, 600)).horizontalAdvance("Connected") + 13 + 2); }
protected:
    void paintEvent(QPaintEvent*) override {
        const Theme& th = Theme::I(); QPainter p(this); p.setRenderHint(QPainter::Antialiasing);
        const QColor dot = th.is3() ? QColor("#00d2ff") : th.t().accent;
        for (int i = 4; i >= 1; --i) { QColor g = dot; g.setAlphaF(0.12 * (5 - i) / 4.0); p.setPen(Qt::NoPen); p.setBrush(g); p.drawEllipse(QPointF(3.5, height() / 2.0), 3.5 + i, 3.5 + i); }
        p.setPen(Qt::NoPen); p.setBrush(dot); p.drawEllipse(QPointF(3.5, height() / 2.0), 3.5, 3.5);
        QFont f = Theme::uiFont(12, 600); f.setLetterSpacing(QFont::AbsoluteSpacing, 0.2); p.setFont(f);
        if (th.is3()) drawGradText(p, QRectF(rect()), QRectF(13, 0, width() - 13, height()), "Connected", f, Qt::AlignLeft);
        else { p.setPen(th.t().accent); p.drawText(QRect(13, 0, width() - 13, height()), Qt::AlignVCenter, "Connected"); }
    }
};
QJsonObject paneDefaults(const QString& pane) {
    if (pane == "launch") return QJsonObject{{"startWithWindows", false}, {"startMinimized", false}, {"showNotifications", true}, {"keepAwake", true}};
    if (pane == "library") return QJsonObject{{"rememberLastFolder", true}, {"lastFolder", ""}, {"useServerFileTime", false}, {"removeMissing", false}};
    if (pane == "behavior") return QJsonObject{{"confirmBeforeStart", true}, {"showCompleteDialog", true}, {"startWhileDialog", true}, {"queueOnLater", true}, {"confirmDelete", true},
        {"ignoreMtime", false}, {"ignoreSsl", false}, {"retryFailed", false}, {"retryCount", 3}, {"duplicateAction", "ask"}};
    if (pane == "speed") return QJsonObject{{ZDM_STR("connectionsPerFile"), 8}, {"maxConcurrent", 0}, {"throttleEnabled", false}, {"throttleValue", 1}, {"throttleUnit", "MB"}, {"limitEnabled", false},
        {"limitMB", 200}, {"limitHours", 5}, {"warnBeforeStop", true}, {"exceptions", QJsonArray{}}};
    if (pane == "proxy") return QJsonObject{{"enabled", false}, {"mode", "off"}, {"type", "http"}, {"host", ""}, {"port", 0}, {"username", ""}, {"password", ""}};
    return QJsonObject{};
}
}

struct SettingsDialog::Impl {
    Store* s; Bridge* b; SettingsDialog* w; QJsonObject model;
    QTimer saveTimer; int saveGen = 0; QString pane = "launch";
    QTimer satTimer; int pendingSat = -1;
    QVector<NavItem*> nav; QVector<QWidget*> panes; QLabel *heading, *sub; QVector<std::function<void()>> refreshers;
    QWidget *satRow = nullptr, *exceptionHost = nullptr; QVBoxLayout* exceptionList = nullptr; QLabel *libNote = nullptr, *setNote = nullptr, *restoreNote = nullptr, *excError = nullptr;
    ExtensionPanel* browsers = nullptr; QVector<QWidget*> proxyManual;
    QLineEdit *exHost, *exUa, *exUser, *exPass; QComboBox* exCount;

    static const QStringList& names() { static const QStringList n = {"launch", "catch", "library", "behavior", "speed", "proxy", "look"}; return n; }
    void schedule() { s->setSettings(model); const int gen = ++saveGen; saveTimer.stop(); saveTimer.disconnect(); saveTimer.setSingleShot(true); QObject::connect(&saveTimer, &QTimer::timeout, w, [this, gen] { persist(gen); }); saveTimer.start(250); }
    void persist(int gen) {
        if (gen != saveGen) return;
        QJsonObject payload = model; payload.remove("scheduler");
        const QJsonObject next = b->invoke("settings:update", payload).toObject();
        if (gen != saveGen || next.isEmpty()) return;
        model = next; s->setSettings(next);
    }
    void set(const QString& path, const QJsonValue& v) { model = setPath(model, path, v); schedule(); }
    void pushAppearance() { const QJsonObject a = model.value("appearance").toObject(); b->send("appearance:changed", a); Theme::I().apply(a); syncSat(); }
    void applySat(int x) { model = setPath(model, "appearance.iconSaturation", x); Theme::I().setIconSaturation(x); schedule(); }
    void syncSat() { if (satRow) satRow->setVisible(getPath(model, "appearance.theme").toString() == "theme3"); }

    // ---- card + row builders
    CardW* card(QVBoxLayout* pv, const QString& title) { auto* c = new CardW(title, panes.last()); pv->addWidget(c); return c; }
    void hint(CardW* c, const QString& t, int bottom = 12) {          // .settings-hint { margin: -4px 0 12px }
        if (c->v->count() == 2) { delete c->v->takeAt(1); c->v->addSpacing(6); }
        auto* l = makeLabel(t, 11, 400, "muted"); l->setWordWrap(true); c->v->addWidget(l); c->v->addSpacing(bottom);
    }
    void toggle(CardW* c, const QString& text, const QString& path) {
        auto* r = new ToggleRow(text, 13, 8); c->v->addWidget(r);
        auto refresh = [=] { r->toggle()->setCheckedNoAnim(getPath(model, path).toBool()); };
        refresh(); refreshers << refresh;
        QObject::connect(r->toggle(), &QAbstractButton::toggled, w, [this, path](bool on) {
            set(path, on);
            if (path == "appearance.columnLines") pushAppearance();
            if (path == "proxy.enabled") {}
        });
    }
    QWidget* rowWith(CardW* c, const QString& label, QWidget* control) {
        auto* r = new QWidget; auto* h = hbox(r, 16, QMargins(0, 8, 0, 8)); auto* l = makeLabel(label, 13, 400, "t1"); l->setWordWrap(true); h->addWidget(l, 1); h->addWidget(control, 0, Qt::AlignVCenter); c->v->addWidget(r); return r;
    }
    QComboBox* select(CardW* c, const QString& label, const QString& path, const QVector<QPair<QString, QVariant>>& items, int width = 260) {
        auto* cb = makeCombo("set"); cb->setFixedWidth(width); for (auto& it : items) cb->addItem(it.first, it.second);
        rowWith(c, label, cb);
        auto refresh = [=] { QSignalBlocker sb(cb); const QJsonValue v = getPath(model, path); const int i = cb->findData(v.isString() ? QVariant(v.toString()) : QVariant(v.toInt())); cb->setCurrentIndex(i >= 0 ? i : 0); };
        refresh(); refreshers << refresh;
        QObject::connect(cb, qOverload<int>(&QComboBox::activated), w, [this, cb, path] {
            const QVariant d = cb->currentData(); set(path, d.typeId() == QMetaType::QString ? QJsonValue(d.toString()) : QJsonValue(d.toInt()));
            if (path == "appearance.theme") pushAppearance();
            if (path == "proxy.mode") { model = setPath(model, "proxy.enabled", d.toString() == "manual"); syncProxy(); }
        });
        return cb;
    }
    QSpinBox* number(CardW* c, const QString& label, const QString& path, int lo, int hi) {
        auto* sp = new QSpinBox; sp->setProperty("v", "set"); sp->setRange(lo, hi); sp->setButtonSymbols(QAbstractSpinBox::NoButtons); sp->setFixedWidth(260); sp->setFont(Theme::uiFont(12));
        rowWith(c, label, sp);
        auto refresh = [=] { QSignalBlocker sb(sp); sp->setValue(getPath(model, path).toInt()); }; refresh(); refreshers << refresh;
        QObject::connect(sp, qOverload<int>(&QSpinBox::valueChanged), w, [this, path](int v) { set(path, v); });
        return sp;
    }
    QLineEdit* text(CardW* c, const QString& label, const QString& path, const QString& ph = QString(), bool pw = false) {
        auto* e = makeEdit("set"); e->setFixedWidth(260); e->setPlaceholderText(ph); if (pw) e->setEchoMode(QLineEdit::Password);
        rowWith(c, label, e);
        auto refresh = [=] { QSignalBlocker sb(e); e->setText(getPath(model, path).toString()); }; refresh(); refreshers << refresh;
        QObject::connect(e, &QLineEdit::textEdited, w, [this, path](const QString& t) { set(path, t); });
        return e;
    }
    QLineEdit* pathRow(CardW* c, const QString& path) {
        auto* r = new QWidget; auto* h = hbox(r, 8, QMargins(0, 0, 0, 8)); auto* e = makeEdit("set"); auto* br = new PushButton(PushButton::Secondary, "Browse");
        h->addWidget(e, 1); h->addWidget(br); c->v->addWidget(r);
        auto refresh = [=] { QSignalBlocker sb(e); e->setText(getPath(model, path).toString()); }; refresh(); refreshers << refresh;
        QObject::connect(e, &QLineEdit::textEdited, w, [this, path](const QString& t) { set(path, t); });
        QObject::connect(br, &QAbstractButton::clicked, w, [this, path, e] { const QString f = b->invoke("settings:pick-folder").toString(); if (f.isEmpty()) return; e->setText(f); set(path, f); });
        return e;
    }
    QWidget* actions(CardW* c, const QVector<QPair<QString, std::function<void()>>>& btns) {
        auto* r = new QWidget; auto* h = hbox(r, 8, QMargins(0, 8, 0, 0)); for (auto& bt : btns) { auto* x = new PushButton(PushButton::Secondary, bt.first); QObject::connect(x, &QAbstractButton::clicked, w, bt.second); h->addWidget(x); } h->addStretch(1); c->v->addWidget(r); return r;
    }
    QLabel* note(CardW* c) { auto* l = makeLabel("", 11, 400, "muted"); l->setWordWrap(true); l->hide(); c->v->addSpacing(10); c->v->addWidget(l); return l; }
    void syncProxy() {
        const bool manual = getPath(model, "proxy.mode").toString() == "manual";
        for (QWidget* r : proxyManual) { auto* ef = qobject_cast<QGraphicsOpacityEffect*>(r->graphicsEffect()); if (!ef) { ef = new QGraphicsOpacityEffect(r); r->setGraphicsEffect(ef); } ef->setOpacity(manual ? 1.0 : 0.45); r->setEnabled(manual); }
    }

    // ---- exceptions list
    void paintExceptions() {
        if (!exceptionList) return;
        while (QLayoutItem* it = exceptionList->takeAt(0)) { if (it->widget()) it->widget()->deleteLater(); delete it; }
        const QJsonArray rows = getPath(model, "speed.exceptions").toArray();
        if (rows.isEmpty()) { auto* l = makeLabel("No hosts yet. Add one below.", 12, 400, "muted"); l->setContentsMargins(0, 2, 0, 8); exceptionList->addWidget(l); return; }
        for (int i = 0; i < rows.size(); ++i) {
            const QJsonObject row = rows[i].toObject();
            auto* r = new QWidget; auto* h = hbox(r, 16, QMargins(0, 8, 0, 8)); auto* host = makeLabel(row.value("host").toString(), 13, 400, "t1"); host->setToolTip(row.value("host").toString() + " \xC2\xB7 " + row.value("userAgent").toString()); h->addWidget(host, 1);
            auto* cb = makeCombo("sel"); cb->setFixedWidth(88); const int cur = row.value("connections").toInt(8); QList<int> ch = {1, 2, 4, 8, 16, 32}; if (!ch.contains(cur)) ch.prepend(cur); for (int n : ch) cb->addItem(QString::number(n), n);
            cb->setCurrentIndex(cb->findData(cur)); h->addWidget(cb);
            auto* rm = new PushButton(PushButton::Secondary, "Remove"); rm->metrics(10, 4, 4, 500); h->addWidget(rm);
            r->setProperty("rowLine", true); exceptionList->addWidget(r); exceptionList->addWidget(hsep("1"));
            QObject::connect(cb, qOverload<int>(&QComboBox::activated), w, [this, i, cb] { QJsonArray a = getPath(model, "speed.exceptions").toArray(); QJsonObject o = a[i].toObject(); o["connections"] = cb->currentData().toInt(); a[i] = o; set("speed.exceptions", a); });
            QObject::connect(rm, &QAbstractButton::clicked, w, [this, i] { QJsonArray a = getPath(model, "speed.exceptions").toArray(); a.removeAt(i); set("speed.exceptions", a); QTimer::singleShot(0, w, [this] { paintExceptions(); }); });
        }
    }
    void addException() {
        QString host = exHost->text().trimmed().toLower(); host.remove(QRegularExpression("^[a-z][a-z0-9+.-]*://")); host = host.section(QRegularExpression("[/?#]"), 0, 0); host.remove(QRegularExpression(":\\d+$")); host.remove(QRegularExpression("^\\*\\.")); host.remove(QRegularExpression("\\.$"));
        if (host.startsWith("www.") && host.size() > 4) host = host.mid(4);
        if (host.isEmpty() || !QRegularExpression("^[a-z0-9.-]+$").match(host).hasMatch() || !host.contains('.')) { excError->setText(exHost->text().trimmed().isEmpty() ? "Type a host first" : "Use a host like cdn.example.com"); excError->show(); exHost->setFocus(); return; }
        excError->hide();
        QJsonArray rows = getPath(model, "speed.exceptions").toArray(), next;
        for (const auto& r : rows) if (r.toObject().value("host").toString() != host) next.append(r);
        next.append(QJsonObject{{"host", host}, {"connections", exCount->currentData().toInt()}, {"userAgent", exUa->text().trimmed()}, {"username", exUser->text().trimmed()}, {"password", exPass->text()}});
        set("speed.exceptions", next); exHost->clear(); exUa->clear(); exUser->clear(); exPass->clear(); paintExceptions(); exHost->setFocus();
    }

    void showPane(const QString& name) {
        pane = name; static const QHash<QString, QPair<QString, QString>> copy = {
            {"launch", {"Launch", "How ZDM starts and stays out of the way"}}, {"catch", {"Extension", "Take over from the browser \xE2\x80\x94 only with the extension connected"}},
            {"library", {"Library", "Where finished files and staging parts live"}}, {"behavior", {"Behavior", "Sheets, duplicates, and how ZDM talks to servers"}},
            {"speed", {"Speed", "How hard ZDM hits a file and the network"}}, {"proxy", {"Proxy", "Off, the Windows proxy, or an address you type"}},
            {"look", {"Look", "Theme 1 is dark gray with blue icons. Theme 2 is a soft white with blue icons. Theme 3 is dark gray with neon icons. Theme 4 is dark gray with red icons. Icon saturation applies to Theme 3 icons only"}}};
        for (int i = 0; i < names().size(); ++i) { nav[i]->setChecked(names()[i] == name); panes[i]->setVisible(names()[i] == name); }
        heading->setText(copy[name].first); sub->setText(QString::fromUtf8(copy[name].second.toUtf8()));
        if (name == "catch" && browsers) browsers->refreshStatus();
    }
    void paintAll() { for (auto& f : refreshers) f(); paintExceptions(); if (browsers) browsers->setRows(getPath(model, "catch.detected").toArray()); syncProxy(); syncSat(); }
};

SettingsDialog::SettingsDialog(Store* st)
    : FramelessWindow([] { TitleSpec t; t.h = 34; t.caption = "Preferences - Zetta Download Manager"; t.border = true; t.buttons = 1; return t; }(), true, false), d(new Impl) {
    d->s = st; d->b = st->bridge(); d->w = this; d->model = d->b->invoke("settings:get").toObject();
    d->satTimer.setSingleShot(true);
    connect(&d->satTimer, &QTimer::timeout, this, [this] { if (d->pendingSat >= 0) d->applySat(d->pendingSat); });
    resize(920, 640); setMinimumSize(920, 640);
    auto* shell = new QWidget; auto* sh = hbox(shell, 0); auto* top = vbox(body(), 0); top->addWidget(shell);
    // nav
    auto* nav = new Nav(shell); auto* nv = vbox(nav, 2, QMargins(10, 16, 10, 16)); nv->setAlignment(Qt::AlignTop);
    auto* nt = makeLabel("PREFERENCES", 11, 700, "muted"); { QFont f = nt->font(); f.setLetterSpacing(QFont::AbsoluteSpacing, 1.32); nt->setFont(f); } nt->setContentsMargins(10, 6, 10, 14); nv->addWidget(nt);
    static const char* labels[7] = {"Launch", "Extension", "Library", "Behavior", "Speed", "Proxy", "Look"};
    for (int i = 0; i < 7; ++i) { auto* b = new NavItem(labels[i], nav); d->nav << b; nv->addWidget(b); connect(b, &QAbstractButton::clicked, this, [this, i] { d->showPane(Impl::names()[i]); }); }
    sh->addWidget(nav);
    // main
    auto* main = new QWidget; auto* mv = vbox(main, 0);
    auto* tp = new QWidget; auto* tv = vbox(tp, 2, QMargins(20, 18, 20, 12)); d->heading = makeLabel("Launch", 18, 650, "t1"); d->sub = makeLabel("", 12, 400, "muted"); d->sub->setWordWrap(true); tv->addWidget(d->heading); tv->addWidget(d->sub);
    mv->addWidget(tp); mv->addWidget(hsep("1"));
    auto* scroll = new QScrollArea; scroll->setWidgetResizable(true); scroll->setFrameShape(QFrame::NoFrame); scroll->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff); scroll->viewport()->setAutoFillBackground(false); scroll->viewport()->setStyleSheet("background: transparent;");
    auto* sc = new QWidget; sc->setAutoFillBackground(false); sc->setStyleSheet("background: transparent;"); auto* scv = vbox(sc, 0, QMargins(20, 16, 20, 24)); scv->setAlignment(Qt::AlignTop); scroll->setWidget(sc); mv->addWidget(scroll, 1);
    auto newPane = [&]() { auto* p = new QWidget; auto* v = vbox(p, 12); v->setAlignment(Qt::AlignTop); scv->addWidget(p); d->panes << p; return v; };

    // ---- launch
    { auto* v = newPane(); auto* c = d->card(v, "Startup");
      d->toggle(c, "Start ZDM with Windows", "launch.startWithWindows"); d->toggle(c, "Open in the tray, not the window", "launch.startMinimized");
      d->toggle(c, "Desktop toast when a file finishes", "launch.showNotifications"); d->toggle(c, "Keep the computer awake while a file is downloading", "launch.keepAwake"); }
    // ---- catch
    { auto* v = newPane(); auto* c = d->card(v, "Browsers");
      d->browsers = new ExtensionPanel(d->b, getPath(d->model, "catch.detected").toArray(), c);
      c->v->addWidget(d->browsers);
      connect(d->browsers, &ExtensionPanel::rowsChanged, this, [this](const QJsonArray& rows) { d->model = setPath(d->model, "catch.detected", rows); d->s->setSettings(d->model); }); }
    // ---- library
    { auto* v = newPane(); auto* c = d->card(v, "Default drop zone"); d->pathRow(c, "library.defaultPath");
      d->toggle(c, "Remember the last folder I pick in the start sheet", "library.rememberLastFolder"); d->toggle(c, QString::fromUtf8("Stamp finished files with the server\xE2\x80\x99s time"), "library.useServerFileTime");
      auto* c2 = d->card(v, "Per-kind folders"); d->hint(c2, "ZDM sorts by file kind, then drops the file in that folder.");
      static const QPair<const char*, const char*> kinds[] = {{"general", "General"}, {"compressed", "Compressed"}, {"documents", "Documents"}, {"music", "Sounds"}, {"programs", "Programs"}, {"video", "Video"}, {"images", "Images"}};
      for (auto& k : kinds) {
          auto* r = new QWidget; auto* h = hbox(r, 8); auto* l = makeLabel(k.second, 12, 400, "t2"); l->setFixedWidth(110); auto* e = makeEdit("set"); auto* br = new PushButton(PushButton::Secondary, "Browse");
          h->addWidget(l); h->addWidget(e, 1); h->addWidget(br); c2->v->addWidget(r); c2->v->addSpacing(8);
          const QString key = k.first; const QString path = QString("library.folders.%1").arg(key);
          auto refresh = [=] { QSignalBlocker sb(e); const QString f = getPath(d->model, path).toString(); e->setText(f.isEmpty() ? getPath(d->model, "library.defaultPath").toString() : f); }; refresh(); d->refreshers << refresh;
          connect(e, &QLineEdit::editingFinished, this, [this, path, e] { d->set(path, e->text().trimmed()); });
          connect(br, &QAbstractButton::clicked, this, [this, path, e] { const QString f = d->b->invoke("settings:pick-folder").toString(); if (f.isEmpty()) return; e->setText(f); d->set(path, f); });
      }
      auto* c3 = d->card(v, "Staging (parts)"); d->hint(c3, "Chunk files live here until the merge finishes. Prefer a fast local drive."); d->pathRow(c3, "library.tempPath");
      auto* c4 = d->card(v, "Missing files"); d->hint(c4, "Finished items whose file is no longer in the folder can leave the list."); d->toggle(c4, "Drop finished items when the file is gone", "library.removeMissing");
      d->libNote = d->note(c4);
      auto act = [this](const QString& ch, QLabel* n) { n->hide(); const QJsonObject r = d->b->invoke(ch).toObject(); const QString m = r.value("message").toString(); n->setText(m); n->setVisible(!m.isEmpty()); };
      d->actions(c4, {{"Check the library now", [=] { act("library:sweep-missing", d->libNote); }}});
      auto* c5 = d->card(v, "Download list"); d->hint(c5, "A JSON file of every item in the list. Import adds items that are not already there.");
      auto* ln = d->note(c5); d->actions(c5, {{"Export list", [=] { act("library:export", ln); }}, {"Import list", [=] { act("library:import", ln); }}});
      auto* c6 = d->card(v, "Settings backup"); d->hint(c6, "A JSON file of your app preferences and configurations. Import restores your settings."); d->setNote = d->note(c6);
      d->actions(c6, {{"Export settings", [=] { act("settings:export", d->setNote); }},
                      {"Import settings", [=] { d->setNote->hide(); const QJsonObject r = d->b->invoke("settings:import").toObject(); d->setNote->setText(r.value("message").toString()); d->setNote->setVisible(!d->setNote->text().isEmpty());
                                                if (r.value("ok").toBool() && r.value("settings").isObject()) { d->model = r.value("settings").toObject(); d->paintAll(); } }}}); }
    // ---- behavior
    { auto* v = newPane(); auto* c = d->card(v, "Start sheet");
      d->toggle(c, "Ask me before a download starts", "behavior.confirmBeforeStart"); d->toggle(c, "Start the file while the info sheet is still open", "behavior.startWhileDialog");
      d->toggle(c, "Ask before parking a file on Download later", "behavior.queueOnLater"); d->toggle(c, "Tell me when the file is ready", "behavior.showCompleteDialog");
      d->toggle(c, "Ask before deleting downloads", "behavior.confirmDelete"); d->toggle(c, "Ignore server time changes when a download resumes", "behavior.ignoreMtime");
      d->toggle(c, "Ignore site certificates this computer does not trust", "behavior.ignoreSsl"); d->toggle(c, "Try a failed download again on its own", "behavior.retryFailed");
      d->number(c, "Attempts", "behavior.retryCount", 1, 10);
      auto* c2 = d->card(v, "Cancel button"); d->toggle(c2, "Ask me when I press Cancel", "behavior.cancelAsk");
      d->select(c2, "If I skip the question, do this", "behavior.cancelAction", {{"Keep: close the window and pause", "keep"}, {"Cancel the download", "abandon"}});
      d->hint(c2, "Keep closes the progress window, so the download pauses and the saved pieces stay. Cancel deletes those pieces and leaves the file in the list as not downloaded.");
      auto* c3 = d->card(v, "Same link twice");
      d->select(c3, "If this URL is already in the list", "behavior.duplicateAction", {{"Ask me", "ask"}, {"Save another copy with a number", "number"}, {"Replace the existing file", "replace"}, {"Continue the one already in the list", "resume"}, {"Leave the existing one alone", "skip"}});
      auto* c4 = d->card(v, "Prompts and dialogs"); d->hint(c4, "Restore dialogs and confirmation questions you chose not to show again."); d->restoreNote = d->note(c4);
      d->actions(c4, {{"Restore all hidden dialogs", [this] {
          for (const char* k : {"showCompleteDialog", "confirmBeforeStart", "confirmDelete", "cancelAsk", "queueOnLater"}) d->model = setPath(d->model, QString("behavior.") + k, true);
          d->model = setPath(d->model, "behavior.duplicateAction", "ask"); d->schedule(); d->paintAll(); d->restoreNote->setText("All dialogs and confirmation prompts have been restored."); d->restoreNote->show(); }}}); }
    // ---- speed
    { auto* v = newPane(); auto* c = d->card(v, "Parallelism");
      d->select(c, "Connections per file", ZDM_STR("speed.connectionsPerFile"), {{"1", 1}, {"2", 2}, {"4", 4}, {"8", 8}, {"16", 16}, {"32", 32}}); d->number(c, "Files at once", "speed.maxConcurrent", 0, 9999);
      auto* c2 = d->card(v, "Per-host settings"); d->hint(c2, "Save a connection count, browser identity, and login for one site. Every other site keeps the numbers above.");
      d->exceptionHost = new QWidget; d->exceptionList = vbox(d->exceptionHost, 0); c2->v->addWidget(d->exceptionHost);
      auto mk = [&](const QString& l, bool pw, const QString& ph) { auto* e = makeEdit("set"); e->setFixedWidth(260); e->setPlaceholderText(ph); if (pw) e->setEchoMode(QLineEdit::Password); d->rowWith(c2, l, e); return e; };
      d->exHost = mk("Host", false, "cdn.example.com"); d->exUa = mk("User agent", false, "Leave empty to keep the normal one"); d->exUser = mk("Login", false, ""); d->exPass = mk("Password", true, "");
      d->exCount = makeCombo("set"); d->exCount->setFixedWidth(260); for (int n : {1, 2, 4, 8, 16, 32}) d->exCount->addItem(QString::number(n), n); d->exCount->setCurrentIndex(3); d->rowWith(c2, "Connections for this host", d->exCount);
      auto* ar = new QWidget; auto* ah = hbox(ar, 12, QMargins(0, 6, 0, 0)); d->excError = makeLabel("", 11, 400, "danger"); d->excError->hide(); ah->addWidget(d->excError); ah->addStretch(1);
      auto* addB = new PushButton(PushButton::Secondary, "Add host"); ah->addWidget(addB); c2->v->addWidget(ar);
      connect(addB, &QAbstractButton::clicked, this, [this] { d->addException(); }); connect(d->exHost, &QLineEdit::returnPressed, this, [this] { d->addException(); });
      connect(d->exHost, &QLineEdit::textChanged, this, [this] { d->excError->hide(); });
      auto* c3 = d->card(v, "Pace"); d->hint(c3, "One ceiling for every active file together \xE2\x80\x94 not per connection. Applies while downloads run.");
      d->toggle(c3, "Limit total download speed", "speed.throttleEnabled");
      { auto* r = new QWidget; auto* h = hbox(r, 16, QMargins(0, 8, 0, 8)); h->addWidget(makeLabel("Ceiling", 13, 400, "t1"), 1);
        auto* f = new QWidget; auto* fh = hbox(f, 8); auto* sp = new QDoubleSpinBox; sp->setProperty("v", "set"); sp->setRange(1, 1e9); sp->setSingleStep(0.1); sp->setDecimals(1); sp->setButtonSymbols(QAbstractSpinBox::NoButtons); sp->setFixedWidth(88); sp->setFont(Theme::uiFont(12));
        auto* un = makeCombo("set"); un->setFixedWidth(88); un->addItem("KB/s", "KB"); un->addItem("MB/s", "MB"); fh->addWidget(sp); fh->addWidget(un); h->addWidget(f); c3->v->addWidget(r);
        auto refresh = [=] { QSignalBlocker a(sp), b2(un); sp->setValue(getPath(d->model, "speed.throttleValue").toDouble()); un->setCurrentIndex(un->findData(getPath(d->model, "speed.throttleUnit").toString())); }; refresh(); d->refreshers << refresh;
        connect(sp, qOverload<double>(&QDoubleSpinBox::valueChanged), this, [this](double x) { d->set("speed.throttleValue", x); });
        connect(un, qOverload<int>(&QComboBox::activated), this, [this, un] { d->set("speed.throttleUnit", un->currentData().toString()); }); }
      auto* c4 = d->card(v, "Cap"); d->toggle(c4, "Stop after a data budget", "speed.limitEnabled");
      { auto* r = new QWidget; auto* h = hbox(r, 16, QMargins(0, 8, 0, 8)); h->addWidget(makeLabel("No more than", 13, 400, "t1"), 1);
        auto* f = new QWidget; auto* fh = hbox(f, 8);
        auto mkSp = [&](const QString& path) { auto* sp = new QSpinBox; sp->setProperty("v", "set"); sp->setRange(1, 100000000); sp->setButtonSymbols(QAbstractSpinBox::NoButtons); sp->setFixedWidth(88); sp->setFont(Theme::uiFont(12));
            auto refresh = [=] { QSignalBlocker a(sp); sp->setValue(getPath(d->model, path).toInt()); }; refresh(); d->refreshers << refresh; connect(sp, qOverload<int>(&QSpinBox::valueChanged), this, [this, path](int x) { d->set(path, x); }); return sp; };
        fh->addWidget(mkSp("speed.limitMB")); fh->addWidget(makeLabel("MB every", 11, 400, "muted")); fh->addWidget(mkSp("speed.limitHours")); fh->addWidget(makeLabel("hours", 11, 400, "muted")); h->addWidget(f); c4->v->addWidget(r); }
      d->toggle(c4, "Warn me before the cap pauses the queue", "speed.warnBeforeStop"); }
    // ---- proxy
    { auto* v = newPane(); auto* c = d->card(v, "Optional hop"); d->hint(c, "System uses the Windows proxy, including a PAC file. Manual uses the address below.");
      d->select(c, "Proxy", "proxy.mode", {{"Off", "off"}, {"Windows proxy and PAC", "system"}, {"Manual", "manual"}});
      auto man = [&](QWidget* r) { d->proxyManual << r; };
      auto* cbT = d->select(c, "Kind", "proxy.type", {{"HTTP", "http"}, {"HTTPS", "https"}, {"SOCKS5", "socks5"}}); man(cbT->parentWidget());
      man(d->text(c, "Host", "proxy.host", "127.0.0.1")->parentWidget()); man(d->number(c, "Port", "proxy.port", 0, 65535)->parentWidget());
      man(d->text(c, "User", "proxy.username", "optional")->parentWidget()); man(d->text(c, "Password", "proxy.password", "optional", true)->parentWidget()); }
    // ---- look
    { auto* v = newPane(); auto* c = d->card(v, "Theme");
      d->select(c, "Theme", "appearance.theme", {{"Theme 1", "theme1"}, {"Theme 2", "theme2"}, {"Theme 3", "theme3"}, {"Theme 4", "theme4"}});
      d->toggle(c, "Show lines between columns", "appearance.columnLines");
      auto* sl = new QSlider(Qt::Horizontal); sl->setRange(0, 100); sl->setFixedWidth(200); auto* val = makeLabel("100%", 12, 400, "t2"); val->setFixedWidth(38); val->setAlignment(Qt::AlignRight | Qt::AlignVCenter);
      auto* f = new QWidget; auto* fh = hbox(f, 10); fh->addWidget(sl); fh->addWidget(val); d->satRow = d->rowWith(c, "Icon saturation", f);
      auto refresh = [=] { QSignalBlocker a(sl); const int pct = qBound(0, getPath(d->model, "appearance.iconSaturation").toInt(100), 100); sl->setValue(pct); val->setText(QString::number(pct) + "%"); }; refresh(); d->refreshers << refresh;
      connect(sl, &QSlider::valueChanged, this, [this, val](int x) {
          val->setText(QString::number(x) + "%");
          d->pendingSat = x;
          d->satTimer.start(160);
      });
      connect(sl, &QSlider::sliderReleased, this, [this, sl] { d->satTimer.stop(); d->applySat(sl->value()); });
      }

    // footer
    mv->addWidget(hsep("1"));
    auto* ft = new QWidget; auto* fh = hbox(ft, 0, QMargins(20, 12, 20, 12));
    auto* reset = new PushButton(PushButton::Secondary, "Restore defaults"); auto* done = new PushButton(PushButton::Primary, "Done"); fh->addWidget(reset); fh->addStretch(1); fh->addWidget(done); mv->addWidget(ft);
    sh->addWidget(main, 1);

    connect(done, &QAbstractButton::clicked, this, [this] { d->saveTimer.stop(); d->persist(d->saveGen); close(); });
    connect(reset, &QAbstractButton::clicked, this, [this, reset] {
        const QString pane = d->pane; d->saveTimer.stop(); ++d->saveGen;
        if (pane == "look") { d->model = setPath(d->model, "appearance.columnLines", false); d->model = setPath(d->model, "appearance.iconSaturation", 100); }
        else if (pane == "library") { const QJsonObject ld = paneDefaults("library"); for (auto it = ld.begin(); it != ld.end(); ++it) d->model = setPath(d->model, "library." + it.key(), it.value()); }
        else if (pane != "catch") d->model = setPath(d->model, pane, paneDefaults(pane));
        d->s->setSettings(d->model); d->paintAll(); d->showPane(pane); if (pane == "look") d->pushAppearance();
        const QJsonObject restored = d->b->invoke("settings:restore-part", pane).toObject();
        if (!restored.isEmpty()) { d->model = restored; d->s->setSettings(restored); d->paintAll(); d->showPane(pane); if (pane == "look") d->pushAppearance(); }
        const QString old = reset->text(); reset->setText("Restored"); QTimer::singleShot(1200, this, [reset, old] { reset->setText(old); });
    });
    connect(d->s->bridge(), &Bridge::event, this, [this](const QString& ch, const QJsonValue&) { if (ch == "browser:status-changed" && d->browsers) d->browsers->refreshStatus(); });
    d->paintAll(); d->showPane("launch");
}
