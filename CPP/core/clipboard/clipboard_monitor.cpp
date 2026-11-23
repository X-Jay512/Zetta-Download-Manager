#include "zdm_str.hpp"
#include "clipboard_monitor.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <optional>

#include "util.h"

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

namespace dm {

namespace {

// clipboard.readText(); nullopt when the clipboard is busy (another app holds it), so a
// transient failure is not mistaken for "the clipboard changed".
#ifdef _WIN32
std::optional<std::string> readClipboardText() {
  if (!OpenClipboard(nullptr)) return std::nullopt;
  std::string result;
  if (HANDLE h = GetClipboardData(CF_UNICODETEXT)) {
    if (const wchar_t* p = static_cast<const wchar_t*>(GlobalLock(h))) {
      result = wideToUtf8(p);
      GlobalUnlock(h);
    }
  }
  CloseClipboard();
  return result;
}
#else
// Best-effort fallback for Linux/macOS dev builds (needs pbpaste / xclip / wl-paste).
std::optional<std::string> readClipboardText() {
#ifdef __APPLE__
  const char* cmd = "pbpaste 2>/dev/null";
#else
  const char* cmd = "xclip -selection clipboard -o 2>/dev/null || wl-paste -n 2>/dev/null";
#endif
  FILE* pipe = popen(cmd, "r");
  if (!pipe) return std::nullopt;
  std::string out;
  char buf[4096];
  std::size_t n;
  while ((n = std::fread(buf, 1, sizeof buf, pipe)) > 0) out.append(buf, n);
  pclose(pipe);
  return out;
}
#endif

bool startsWithNoCase(const std::string& s, const char* prefix) {
  for (std::size_t i = 0; prefix[i]; ++i) {
    if (i >= s.size() || std::tolower(static_cast<unsigned char>(s[i])) != prefix[i]) return false;
  }
  return true;
}

// /^https?:\/\/[^\s]+$/i  -- hand written: std::regex can overflow the stack on huge clipboards.
bool looksLikeHttpUrl(const std::string& s) {
  std::size_t prefix = 0;
  if (startsWithNoCase(s, ZDM_STR("https://"))) prefix = 8;
  else if (startsWithNoCase(s, ZDM_STR("http://"))) prefix = 7;
  else return false;
  if (s.size() == prefix) return false;
  return std::none_of(s.begin() + static_cast<std::ptrdiff_t>(prefix), s.end(),
                      [](unsigned char c) { return std::isspace(c) != 0; });
}

}  // namespace

const std::vector<std::string>& ClipboardMonitor::defaultExtensions() {
  static const std::vector<std::string> kExtensions = {
      ".zip", ".rar", ".7z",  ".exe", ".msi", ".pdf", ".doc", ".docx", ".mp3", ".mp4",
      ".mkv", ".avi", ".mov", ".flv", ".webm", ".iso", ".tar", ".gz",  ".dmg", ".apk",
      ".deb", ".rpm", ".flac", ".wav", ZDM_STR(".m3u8")};
  return kExtensions;
}

ClipboardMonitor::ClipboardMonitor(EventLoop& loop, std::chrono::milliseconds interval)
    : loop_(loop), interval_(interval), extensions_(defaultExtensions()) {}

ClipboardMonitor::~ClipboardMonitor() { stop(); }

void ClipboardMonitor::setExtensions(const std::vector<std::string>& list) {
  if (list.empty()) return;
  extensions_.clear();
  for (const auto& e : list) {
    const std::string lower = toLower(e);
    extensions_.push_back(!lower.empty() && lower[0] == '.' ? lower : "." + lower);
  }
}

void ClipboardMonitor::start() {
  if (timer_ != 0) return;
  lastContent_ = readClipboardText().value_or("");
  timer_ = loop_.setInterval(interval_, [this] { check(); });
}

void ClipboardMonitor::stop() {
  if (timer_ != 0) {
    loop_.clearTimer(timer_);
    timer_ = 0;
  }
}

void ClipboardMonitor::check() {
  const auto text = readClipboardText();
  if (!text) return;  // clipboard busy; try again on the next tick
  const std::string current = trim(*text);
  if (current == lastContent_) return;
  lastContent_ = current;

  if (!looksLikeHttpUrl(current)) return;

  const std::string lower = toLower(current);
  const bool isDownloadable = std::any_of(extensions_.begin(), extensions_.end(), [&](const std::string& ext) {
    return lower.find(ext) != std::string::npos;  // like String.includes: anywhere in the URL
  });
  if (isDownloadable) urlDetected.emit(current);
}

}  // namespace dm
