#pragma once
// monitor.js -> ClipboardMonitor: polls the clipboard and reports downloadable URLs.

#include <chrono>
#include <string>
#include <vector>

#include "event_loop.h"
#include "dm_signal.h"

namespace dm {

class ClipboardMonitor {
 public:
  explicit ClipboardMonitor(EventLoop& loop,
                            std::chrono::milliseconds interval = std::chrono::milliseconds(1000));
  ~ClipboardMonitor();

  void setExtensions(const std::vector<std::string>& list);
  void start();
  void stop();
  bool isRunning() const { return timer_ != 0; }

  Signal<const std::string&> urlDetected;  // emitter.emit('url-detected', url)

  static const std::vector<std::string>& defaultExtensions();

 private:
  void check();

  EventLoop& loop_;
  std::chrono::milliseconds interval_;
  std::string lastContent_;
  EventLoop::TimerId timer_ = 0;
  std::vector<std::string> extensions_;
};

}  // namespace dm
