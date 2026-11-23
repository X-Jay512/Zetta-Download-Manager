#pragma once
// manager.js -> QueueManager: limits concurrency, honours "hold" and the download schedule.

#include <cstddef>
#include <deque>
#include <limits>
#include <string>
#include <vector>

#include "engine.h"
#include "event_loop.h"
#include "settings_manager.h"
#include "dm_signal.h"

namespace dm {

class QueueManager {
 public:
  static constexpr std::size_t kUnlimited = std::numeric_limits<std::size_t>::max();  // Infinity

  struct Status {
    std::size_t queued;
    std::size_t running;
    std::size_t max;  // kUnlimited when there is no limit
  };

  // `settings` may be null (the JS code guarded `this.settings && this.settings.get`).
  QueueManager(EventLoop& loop, IEngine& engine, SettingsManager* settings);
  ~QueueManager();
  QueueManager(const QueueManager&) = delete;
  QueueManager& operator=(const QueueManager&) = delete;

  void refreshSchedule() { process(); }
  void hold() { held_ = true; }
  void release();
  void setMaxConcurrent(int n);
  void enqueue(const Record& record);
  void startAll();
  void stopAll();
  Status getStatus() const { return {queue_.size(), running_.size(), maxConcurrent_}; }

  Signal<const Record&> started;               // 'started'
  Signal<const std::string&> taskComplete;     // 'task-complete'
  Signal<const std::string&> taskError;        // 'task-error'

 private:
  bool scheduleClosed() const;
  void enforceSchedule();
  void process();
  void freeSlot(const std::string& id);
  void attachEngineListeners();

  EventLoop& loop_;
  IEngine& engine_;
  SettingsManager* settings_;
  std::size_t maxConcurrent_ = kUnlimited;
  std::deque<Record> queue_;
  std::vector<std::string> running_;
  bool held_ = false;
  std::vector<std::string> scheduleHeld_;  // ordered set
  EventLoop::TimerId clock_ = 0;
  Signal<const std::string&>::Connection connComplete_ = 0, connError_ = 0, connPaused_ = 0,
                                         connCancelled_ = 0;
};

}  // namespace dm
