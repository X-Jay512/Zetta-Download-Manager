#include "ExtensionPanel.h"

#include <QButtonGroup>
#include <QDateTime>
#include <QPointer>
#include <QStackedWidget>

namespace {

class BrowserRow : public QWidget {
public:
    explicit BrowserRow(QWidget* parent = nullptr) : QWidget(parent) { setAttribute(Qt::WA_Hover); }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t();
        QPainter p(this);
        p.setRenderHint(QPainter::Antialiasing);
        QPainterPath o;
        o.addRoundedRect(QRectF(rect()), 4, 4);
        p.fillPath(o, underMouse() ? t.border2 : t.border);
        QPainterPath i;
        i.addRoundedRect(QRectF(rect()).adjusted(1, 1, -1, -1), 3, 3);
        p.fillPath(i, t.bg1);
    }
};

class ConnectedMark : public QWidget {
public:
    explicit ConnectedMark(QWidget* parent = nullptr) : QWidget(parent) {
        setFixedHeight(18);
        setFixedWidth(QFontMetrics(Theme::uiFont(12, 600)).horizontalAdvance("Connected") + 15);
    }
protected:
    void paintEvent(QPaintEvent*) override {
        const Theme& th = Theme::I();
        QPainter p(this);
        p.setRenderHint(QPainter::Antialiasing);
        const QColor dot = th.is3() ? QColor("#00d2ff") : th.t().accent;
        p.setPen(Qt::NoPen);
        p.setBrush(dot);
        p.drawEllipse(QPointF(4, height() / 2.0), 3.5, 3.5);
        QFont f = Theme::uiFont(12, 600);
        p.setFont(f);
        if (th.is3()) drawGradText(p, QRectF(rect()), QRectF(13, 0, width() - 13, height()), "Connected", f, Qt::AlignLeft);
        else {
            p.setPen(th.t().accent);
            p.drawText(QRect(13, 0, width() - 13, height()), Qt::AlignVCenter, "Connected");
        }
    }
};

class TextLink : public QAbstractButton {
public:
    TextLink(const QString& text, bool chip, QWidget* parent = nullptr) : QAbstractButton(parent), m_chip(chip) {
        setText(text);
        setCursor(Qt::PointingHandCursor);
        setFocusPolicy(Qt::NoFocus);
        setFont(Theme::uiFont(12, 600));
        connect(&Theme::I(), &Theme::changed, this, [this] { update(); });
    }
    QSize sizeHint() const override {
        const int w = QFontMetrics(font()).horizontalAdvance(text()) + (m_chip ? 16 : 4);
        return {w, QFontMetrics(font()).lineSpacing() + (m_chip ? 8 : 2)};
    }
protected:
    void paintEvent(QPaintEvent*) override {
        const Tokens& t = Theme::I().t();
        QPainter p(this);
        p.setRenderHint(QPainter::Antialiasing);
        if (m_chip) {
            QPainterPath o;
            o.addRoundedRect(QRectF(rect()).adjusted(0, 1, 0, -1), 4, 4);
            p.fillPath(o, underMouse() ? t.hover : t.bg3);
            p.setPen(QPen(t.border2, 1));
            p.drawRoundedRect(QRectF(rect()).adjusted(0.5, 1.5, -0.5, -1.5), 4, 4);
        }
        p.setFont(font());
        p.setPen(Theme::I().t().accent);
        p.drawText(rect(), Qt::AlignCenter, text());
    }
private:
    bool m_chip;
};

QWidget* stepLine(const QString& text, QWidget* extra = nullptr) {
    auto* row = new QWidget;
    auto* h = hbox(row, 6, QMargins(18, 1, 0, 1));
    auto* label = makeLabel(text, 12, 400, "t2", row);
    label->setWordWrap(true);
    h->addWidget(label, 1);
    if (extra) h->addWidget(extra, 0, Qt::AlignVCenter);
    return row;
}

void addTitle(QVBoxLayout* lay, const QString& text, QWidget* extra = nullptr) {
    auto* row = new QWidget;
    auto* h = hbox(row, 8, QMargins(0, 8, 0, 2));
    h->addWidget(makeLabel(text, 13, 650, "t1", row));
    if (extra) h->addWidget(extra, 0, Qt::AlignVCenter);
    h->addStretch(1);
    lay->addWidget(row);
}

PushButton* actionButton(const QString& text, QWidget* parent) {
    auto* button = new PushButton(PushButton::Install, text, parent);
    button->metrics(10, 4, 4, 600);
    button->minW(QFontMetrics(Theme::uiFont(12, 600)).horizontalAdvance(text) + 28);
    button->setFixedHeight(28);
    return button;
}

QJsonObject replaceRow(QJsonArray& rows, const QString& id, const QJsonObject& patch) {
    for (int i = 0; i < rows.size(); ++i) {
        QJsonObject row = rows.at(i).toObject();
        if (row.value("id").toString().compare(id, Qt::CaseInsensitive) != 0) continue;
        for (auto it = patch.begin(); it != patch.end(); ++it) row.insert(it.key(), it.value());
        rows.replace(i, row);
        return row;
    }
    return QJsonObject();
}

}  // namespace

ExtensionPanel::ExtensionPanel(Bridge* bridge, const QJsonArray& initial, QWidget* parent) : QWidget(parent), m_b(bridge), m_rows(initial) {
    auto* lay = vbox(this, 8);
    auto* hint = makeLabel("Only browsers installed on this computer are listed. Connected means the extension is in the browser.", 11, 400, "muted", this);
    hint->setWordWrap(true);
    lay->addWidget(hint);
    auto* host = new QWidget(this);
    m_list = vbox(host, 8);
    lay->addWidget(host);

    auto* actions = new QWidget(this);
    auto* ah = hbox(actions, 12, QMargins(0, 4, 0, 0));
    m_scan = new PushButton(PushButton::Secondary, "Check again", actions);
    auto* scrollNote = makeLabel("Scroll to see a guide on how to install the extension.", 11, 400, "muted", actions);
    scrollNote->setWordWrap(true);
    ah->addWidget(m_scan, 0, Qt::AlignTop);
    ah->addWidget(scrollNote, 1);
    lay->addWidget(actions);
    connect(m_scan, &QAbstractButton::clicked, this, [this] { scan(); });

    auto watch = [this](TextLink* link) {
        connect(link, &QAbstractButton::clicked, this, [this, link] {
            const QString guide = link->property("guide").toString();
            if (!guide.isEmpty()) {
                showGuideNote(QString());
                const QJsonObject res = m_b->invoke("guides:open", guide).toObject();
                if (!res.value("ok").toBool()) showGuideNote(res.value("error").toString("The guide did not open."));
                return;
            }
            const QString value = link->property("copy").toString();
            if (value.isEmpty()) return;
            const QString orig = link->text();
            const QJsonObject res = m_b->invoke("guides:copy", value).toObject();
            link->setText(res.value("ok").toBool() ? "Copied" : "Failed");
            QTimer::singleShot(1200, link, [link, orig] { if (link) link->setText(orig); });
        });
    };
    auto guide = [&](const QString& text, const QString& file) {
        auto* link = new TextLink(text, false, this);
        link->setProperty("guide", file);
        watch(link);
        return link;
    };

    addTitle(lay, "Brave, Edge, and other Chromium browsers");
    lay->addWidget(stepLine("Press Install."));
    lay->addWidget(stepLine("Turn on Developer mode in Extensions.", guide("How to turn on Developer mode", "developer-mode.html")));

    addTitle(lay, "Google Chrome", guide("Chrome guide", "chrome.html"));
    lay->addWidget(stepLine("Press Copy path."));
    auto* chip = new TextLink("chrome://extensions", true, this);
    chip->setProperty("copy", "chrome://extensions");
    watch(chip);
    lay->addWidget(stepLine("Press Install. Chrome will open, then go to the extension manager.", chip));
    lay->addWidget(stepLine("Turn on Developer mode.", guide("How to turn on Developer mode", "developer-mode.html")));
    lay->addWidget(stepLine("Press Load unpacked."));
    lay->addWidget(stepLine("Paste the path in the Folder box at the bottom, then press Select Folder."));

    addTitle(lay, "Firefox and Firefox-based browsers");
    lay->addWidget(stepLine("Press Firefox Add-ons. The add-on page opens. Press Add to Firefox."));

    m_note = makeLabel("", 11, 400, "muted", this);
    m_note->setWordWrap(true);
    m_note->hide();
    lay->addWidget(m_note);

    paintRows();
    m_timer.setInterval(4000);
    connect(&m_timer, &QTimer::timeout, this, [this] { if (isVisible()) refreshStatus(); });
    m_timer.start();
    QTimer::singleShot(0, this, [this] { scan(); });
}

void ExtensionPanel::setRows(const QJsonArray& rows) {
    m_rows = rows;
    paintRows();
}

void ExtensionPanel::showGuideNote(const QString& text) {
    m_note->setText(text);
    m_note->setVisible(!text.isEmpty());
}

void ExtensionPanel::remember() {
    m_b->invoke("settings:update", QJsonObject{{"catch", QJsonObject{{"detected", m_rows}}}});
    emit rowsChanged(m_rows);
}

void ExtensionPanel::scan() {
    if (!m_b) return;
    m_scan->setEnabled(false);
    QPointer<ExtensionPanel> self = this;
    m_b->invokeAsync("browsers:scan", QJsonValue(), [self](const QJsonValue& value, const QString&) {
        if (!self) return;
        self->m_scan->setEnabled(true);
        if (!value.isArray()) return;
        self->m_rows = value.toArray();
        self->paintRows();
        self->remember();
    });
}

void ExtensionPanel::refreshStatus() {
    if (!m_b || m_rows.isEmpty()) return;
    QPointer<ExtensionPanel> self = this;
    m_b->invokeAsync("browsers:get-status", QJsonValue(), [self](const QJsonValue& value, const QString&) {
        if (!self) return;
        if (!value.isArray()) return;
        bool changed = false;
        for (const auto& item : value.toArray()) {
            const QJsonObject status = item.toObject();
            for (int i = 0; i < self->m_rows.size(); ++i) {
                QJsonObject row = self->m_rows.at(i).toObject();
                if (row.value("id").toString() != status.value("id").toString()) continue;
                if (row.value("extension") == status.value("extension")) continue;
                row["extension"] = status.value("extension");
                row["connected"] = status.value("connected");
                self->m_rows.replace(i, row);
                changed = true;
            }
        }
        if (changed) {
            self->paintRows();
            emit self->rowsChanged(self->m_rows);
        }
    });
}

void ExtensionPanel::install(PushButton* button, const QJsonObject& row) {
    const QString id = row.value("id").toString();
    const QString family = row.value("family").toString();
    const bool firefox = family == "firefox" || row.value("id").toString() == "firefox";
    const bool storeButton = firefox || (row.value("installable").toBool(true) == false && family != "chromium");
    const QString orig = button->text();
    button->setEnabled(false);
    button->setText(storeButton ? "Opening..." : "Installing...");
    QPointer<PushButton> alive = button;
    QPointer<ExtensionPanel> self = this;
    m_b->invokeAsync("browsers:install-extension", id, [self, alive, id, orig](const QJsonValue& value, const QString& error) {
        if (!self) return;
        const QJsonObject res = value.toObject();
        auto finish = [&](const QString& label, const QString& tip, bool enable) {
            if (!alive) return;
            alive->setText(label);
            alive->setToolTip(tip);
            alive->setEnabled(enable);
        };
        if (!error.isEmpty()) {
            finish("Failed", error, true);
            return;
        }
        if (res.value("openedPage").toBool()) {
            finish("Opened", QString(), true);
            return;
        }
        if (res.value("openedStore").toBool()) {
            finish(res.value("storeName").toString(orig), QString(), true);
            return;
        }
        if (res.value("extension").isObject() || res.value("detail").isObject()) {
            QJsonObject patch;
            const QJsonValue extension = res.value("extension").isObject() ? res.value("extension") : res.value("detail");
            patch.insert("extension", extension);
            if (res.value("connected").toBool()) {
                patch.insert("connected", true);
                patch.insert("enabled", true);
            }
            replaceRow(self->m_rows, id, patch);
        }
        if (res.value("connected").toBool()) {
            self->paintRows();
            self->remember();
            return;
        }
        if (res.value("stage").toString() == "disabled") {
            finish("Turned off", res.value("error").toString("The extension is in the browser but turned off."), true);
        } else if (res.value("needsRestart").toBool()) {
            finish("Reopen the browser", QString(), true);
        } else if (!res.value("error").toString().isEmpty()) {
            finish("Failed", res.value("error").toString(), true);
        } else {
            finish("Not in the browser yet", QString(), true);
        }
    });
}

void ExtensionPanel::paintRows() {
    if (!m_list) return;
    while (QLayoutItem* item = m_list->takeAt(0)) {
        if (item->widget()) item->widget()->deleteLater();
        delete item;
    }
    if (m_rows.isEmpty()) {
        auto* empty = makeLabel("No browser was found. Install one, then check again.", 11, 400, "muted");
        empty->setWordWrap(true);
        m_list->addWidget(empty);
        return;
    }
    for (const auto& item : m_rows) {
        const QJsonObject row = item.toObject();
        const QString family = row.value("family").toString();
        const bool connected = row.value("extension").toObject().value("enabled").toBool() || row.value("connected").toBool();
        const bool firefox = family == "firefox" || row.value("id").toString() == "firefox";
        const bool storeButton = firefox || (row.value("installable").toBool(true) == false && family != "chromium");
        auto* box = new BrowserRow;
        auto* h = hbox(box, 12, QMargins(12, 8, 12, 8));
        auto* icon = new QLabel(box);
        icon->setFixedSize(18, 18);
        const QString exe = row.value("exe").toString();
        if (!exe.isEmpty()) icon->setPixmap(Theme::fileIcon(exe, 18));
        h->addWidget(icon, 0, Qt::AlignVCenter);

        auto* text = new QWidget(box);
        auto* tv = vbox(text, 0);
        const QString name = row.value("name").toString(row.value("id").toString());
        tv->addWidget(makeLabel(name, 13, 500, "t1", text));
        QString store = row.value("storeName").toString();
        if (store.isEmpty()) store = family == "firefox" ? "Firefox Add-ons" : "Chrome Web Store";
        tv->addWidget(makeLabel(store, 11, 400, "muted", text));
        h->addWidget(text, 1);

        if (connected) h->addWidget(new ConnectedMark(box), 0, Qt::AlignVCenter);

        const bool isChrome = row.value("id").toString() == "chrome";
        if (isChrome) {
            const QString copyLabel = QStringLiteral("Copy path");
            auto* copy = actionButton(copyLabel, box);
            h->addWidget(copy, 0, Qt::AlignVCenter);
            connect(copy, &QAbstractButton::clicked, this, [this, copy, copyLabel] {
                copy->setEnabled(false);
                const QJsonObject res = m_b->invoke("browsers:copy-extension-path", "folder").toObject();
                copy->setText(res.value("ok").toBool() ? "Copied" : "Failed");
                QTimer::singleShot(1200, copy, [copy, copyLabel] {
                    if (!copy) return;
                    copy->setText(copyLabel);
                    copy->setEnabled(true);
                });
            });
        }

        const QString installLabel = storeButton ? store : "Install";
        auto* installBtn = actionButton(installLabel, box);
        if (storeButton && !firefox && row.value("storeUrl").toString().isEmpty()) {
            installBtn->setEnabled(false);
            installBtn->setToolTip(QString("This browser uses %1.").arg(store));
        }
        h->addWidget(installBtn, 0, Qt::AlignVCenter);
        connect(installBtn, &QAbstractButton::clicked, this, [this, installBtn, row] { install(installBtn, row); });
        const QJsonObject ext = row.value("extension").toObject();
        if (!ext.value("id").toString().isEmpty() || !ext.value("path").toString().isEmpty()) {
            box->setToolTip(QString("id=%1 path=%2").arg(ext.value("id").toString(), ext.value("path").toString()));
        }
        m_list->addWidget(box);
    }
}

namespace {

class Choice : public QWidget {
public:
    Choice(const QString& value, const QString& title, const QString& hint, QButtonGroup* group, QWidget* parent)
        : QWidget(parent), m_value(value) {
        auto* lay = vbox(this, 2, QMargins(0, 4, 0, 4));
        m_radio = new RadBox(title, this);
        m_radio->setProperty("value", value);
        group->addButton(m_radio);
        lay->addWidget(m_radio);
        if (!hint.isEmpty()) {
            auto* sub = makeLabel(hint, 11, 400, "muted", this);
            sub->setWordWrap(true);
            sub->setContentsMargins(27, 0, 0, 0);
            lay->addWidget(sub);
        }
    }
    QString value() const { return m_value; }
    RadBox* radio() const { return m_radio; }
private:
    QString m_value;
    RadBox* m_radio;
};

TitleSpec setupSpec() {
    TitleSpec spec;
    spec.h = 34;
    spec.caption = "Extension Setup";
    spec.border = true;
    spec.buttons = 1;
    return spec;
}

}  // namespace

ExtensionSetup::ExtensionSetup(Store* store) : FramelessWindow(setupSpec(), true, false) {
    resize(760, 680);
    setMinimumSize(640, 480);
    Bridge* bridge = store->bridge();
    const QJsonObject settings = bridge->invoke("settings:get").toObject();
    const QJsonObject video = settings.value("video").toObject();
    QString quality = video.value("qualityMode").toString("full");
    QString fps = video.value("fpsDisplay").toString("60");
    if (quality != "full" && quality != "average" && quality != "simple") quality = "full";
    if (fps != "30" && fps != "60" && fps != "off") fps = "60";

    auto* root = vbox(body(), 0);
    auto* brand = new QLabel(body());
    brand->setAlignment(Qt::AlignCenter);
    brand->setPixmap(QPixmap(Theme::assetPath("icons/app.png")).scaled(48, 48, Qt::KeepAspectRatio, Qt::SmoothTransformation));
    brand->setContentsMargins(0, 16, 0, 8);
    root->addWidget(brand);

    auto* stack = new QStackedWidget(body());
    auto* browsersPage = new QScrollArea(stack);
    browsersPage->setWidgetResizable(true);
    browsersPage->setFrameShape(QFrame::NoFrame);
    browsersPage->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    auto* browserHost = new QWidget;
    auto* browserLay = vbox(browserHost, 0, QMargins(20, 8, 20, 16));
    auto* panel = new ExtensionPanel(bridge, settings.value("catch").toObject().value("detected").toArray(), browserHost);
    browserLay->addWidget(panel);
    browsersPage->setWidget(browserHost);
    stack->addWidget(browsersPage);

    auto* customPage = new QScrollArea(stack);
    customPage->setWidgetResizable(true);
    customPage->setFrameShape(QFrame::NoFrame);
    customPage->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    auto* customHost = new QWidget;
    auto* custom = vbox(customHost, 8, QMargins(20, 8, 20, 16));
    custom->addWidget(makeLabel("Extension customization", 16, 650, "t1", customHost));
    auto* customHint = makeLabel("This customizes how the extension shows you the qualities. You can change it later from the extension settings.", 12, 400, "muted", customHost);
    customHint->setWordWrap(true);
    custom->addWidget(customHint);
    custom->addSpacing(8);
    custom->addWidget(makeLabel("Quality list", 13, 650, "t1", customHost));
    auto* qualityGroup = new QButtonGroup(customHost);
    auto addChoice = [&](QButtonGroup* group, const QString& value, const QString& title, const QString& hint) {
        auto* choice = new Choice(value, title, hint, group, customHost);
        custom->addWidget(choice);
        return choice;
    };
    addChoice(qualityGroup, "full", "Full", "Every bitrate stays in the list, with its kbps, with audio selection.")->radio()->setChecked(quality == "full");
    addChoice(qualityGroup, "average", "Average", "Best bitrate for each resolution and format (e.g. 720p MP4 & 720p WebM), with audio selection.")->radio()->setChecked(quality == "average");
    addChoice(qualityGroup, "simple", "Simple", "Show video quality only.")->radio()->setChecked(quality == "simple");
    custom->addSpacing(8);
    custom->addWidget(makeLabel("Frame rate", 13, 650, "t1", customHost));
    auto* fpsGroup = new QButtonGroup(customHost);
    addChoice(fpsGroup, "30", "30 fps and above", QString())->radio()->setChecked(fps == "30");
    addChoice(fpsGroup, "60", "60 fps and above", QString())->radio()->setChecked(fps == "60");
    addChoice(fpsGroup, "off", "Off", QString())->radio()->setChecked(fps == "off");
    custom->addStretch(1);
    customPage->setWidget(customHost);
    stack->addWidget(customPage);
    root->addWidget(stack, 1);

    root->addWidget(hsep("1"));
    auto* foot = new QWidget(body());
    auto* fh = hbox(foot, 8, QMargins(20, 12, 20, 12));
    auto* back = new PushButton(PushButton::Secondary, "Back", foot);
    back->setVisible(false);
    auto* next = new PushButton(PushButton::Primary, "Next", foot);
    fh->addWidget(back);
    fh->addStretch(1);
    fh->addWidget(next);
    root->addWidget(foot);

    connect(back, &QAbstractButton::clicked, this, [=] {
        stack->setCurrentIndex(0);
        next->setText("Next");
        back->setVisible(false);
    });
    connect(next, &QAbstractButton::clicked, this, [=] {
        if (stack->currentIndex() == 0) {
            stack->setCurrentIndex(1);
            next->setText("Done");
            back->setVisible(true);
            return;
        }
        const QString mode = qualityGroup->checkedButton() ? qualityGroup->checkedButton()->property("value").toString() : "full";
        const QString rate = fpsGroup->checkedButton() ? fpsGroup->checkedButton()->property("value").toString() : "60";
        bridge->invoke("settings:update", QJsonObject{{"video", QJsonObject{{"qualityMode", mode}, {"fpsDisplay", rate}, {"qualityStamp", static_cast<double>(QDateTime::currentMSecsSinceEpoch())}}}});
        close();
    });
}
