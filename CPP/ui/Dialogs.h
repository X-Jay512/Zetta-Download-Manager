#pragma once
#include "Widgets.h"
#include "Store.h"

class CopyBtn : public QAbstractButton {                 // .copy-link (svg copy icon)
    Q_OBJECT
public:
    CopyBtn(int box, int glyph, QWidget* parent = nullptr);
    void flashCopied();
protected:
    void paintEvent(QPaintEvent*) override;
private:
    int m_glyph; bool m_copied = false;
};
class GlyphBtn : public QAbstractButton {                // flat text-glyph button (combo ▾)
    Q_OBJECT
public:
    GlyphBtn(const QString& g, int px, QWidget* parent = nullptr);
protected:
    void paintEvent(QPaintEvent*) override;
private:
    QString m_g; int m_px;
};
QLineEdit* makeEdit(const char* variant, QWidget* parent = nullptr, bool readOnly = false);
QComboBox* makeCombo(const char* variant, QWidget* parent = nullptr);

// ---- add-dialog.html / add-dialog.js
class AddDialog : public FramelessWindow {
    Q_OBJECT
public:
    AddDialog(Bridge* b, const QJsonObject& data);
protected:
    void closeEvent(QCloseEvent*) override;
private:
    QString classify(const QString& fileName, const QString& url) const;
    QString folderFor(const QString& kind) const;
    void applyKind(const QString& fileName, const QString& url, qint64 size);
    void paintRemember();
    void paintIcon();
    void submit(const QJsonObject& extra = QJsonObject());
    void showDuplicate(const QJsonObject& rec);
    void parkLater();
    void fit();
    void abandon();
    Bridge* m_b; QJsonObject m_meta, m_opts, m_settings;
    QString m_url, m_armedId; bool m_userPath = false, m_manual = false, m_closed = false;
    qint64 m_size = 0; double m_dur = 0;
    QStackedWidget* m_stack; QWidget *m_pageAdd, *m_pageDup;
    QComboBox* m_kind; QLineEdit *m_name, *m_path, *m_desc; ChkBox* m_remember; QLabel *m_sizeLbl, *m_durLbl, *m_iconLbl, *m_dupName;
    CopyBtn* m_copy; QWidget *m_footAdd, *m_queuePanel; QButtonGroup* m_dupGroup; ChkBox* m_dupRemember;
};

// ---- address-dialog.html (+ address-history.html)
class AddressDialog : public FramelessWindow {
    Q_OBJECT
public:
    explicit AddressDialog(Bridge* b);
    void fill(const QString& url);
private:
    void confirm();
    Bridge* m_b; QLineEdit *m_addr, *m_login, *m_pass; ChkBox* m_auth; QLabel* m_err; QStringList m_hist; bool m_busy = false;
};

// ---- complete-dialog.html
class CompleteDialog : public FramelessWindow {
    Q_OBJECT
public:
    CompleteDialog(Bridge* b, const QJsonObject& data);
};

// ---- properties.html
class PropertiesDialog : public FramelessWindow {
    Q_OBJECT
public:
    PropertiesDialog(Bridge* b, const QJsonObject& data);
};

// ---- refresh-ask.html / refresh-wait.html
class RefreshAsk : public FramelessWindow {
    Q_OBJECT
public:
    RefreshAsk(Bridge* b, const QString& id, const QString& name);
};
class RefreshWait : public FramelessWindow {
    Q_OBJECT
public:
    RefreshWait(Bridge* b, const QString& name);
};

// ---- playlist.html / playlist.js
class PlaylistDialog : public FramelessWindow {
    Q_OBJECT
public:
    PlaylistDialog(Bridge* b, const QString& presetUrl);
private:
    struct Fmt { QString id, ext; int height = 0, abr = 0; double size = 0; };
    struct Vid { QJsonObject entry; bool checked = true, probed = false; QVector<Fmt> v, a; int vh = 0, ab = 0; };
    void load(); void probeAll(); void paintList(); void applyGlobals(); void syncGlobals(); void startDownload(); void loadQueues();
    double rowBytes(const Vid& v) const;
    Bridge* m_b; QVector<Vid> m_vids; int m_cursor = 0, m_alive = 0; bool m_probing = false;
    QLineEdit *m_url, *m_newQ; QComboBox *m_vq, *m_aq, *m_queue; ChkBox *m_all, *m_onlyAudio;
    QWidget* m_rows; QVBoxLayout* m_rowsLayout; QLabel* m_status; PushButton *m_load, *m_dl;
};

// ---- progress.html / progress.js
class ProgressDialog : public FramelessWindow {
    Q_OBJECT
public:
    ProgressDialog(Store* s, const QString& id);
private:
    struct Impl; Impl* d;
};

// ---- scheduler.html / scheduler.js (window part)
class SchedulerDialog : public FramelessWindow {
    Q_OBJECT
public:
    SchedulerDialog(QueueEngine* q, Store* s);
    void navigate(const QString& queueId, const QString& tab);
private:
    struct Impl; Impl* d;
};

// ---- settings.html / settings.js
class SettingsDialog : public FramelessWindow {
    Q_OBJECT
public:
    SettingsDialog(Store* s);
private:
    struct Impl; Impl* d;
};

// ---- main-process window routing (Bridge::openWindow)
class WindowManager : public QObject {
    Q_OBJECT
public:
    WindowManager(Store* s, QueueEngine* q, QObject* parent = nullptr);
    void open(const QString& name, const QJsonValue& arg);
private:
    template <class T> void showUnique(const QString& key, std::function<T*()> make);
    Store* m_s; QueueEngine* m_q; QHash<QString, QPointer<QWidget>> m_open;
};
