#include "zdm_str.hpp"
#include "queue_manager.h"

#include <algorithm>
#include <chrono>

#include "schedule.h"

namespace dm {

namespace {
std::string idOf(const Record& r) { return stringOr(member(r, "id")); }

void eraseValue(std::vector<std::string>& v, const std::string& value) {
  v.erase(std::remove(v.begin(), v.end(), value), v.end());
}
}  // namespace

QueueManager::QueueManager(EventLoop& loop, IEngine& engine, SettingsManager* settings)
    : loop_(loop), engine_(engine), settings_(settings) {
  clock_ = loop_.setInterval(std::chrono::seconds(20), [this] { process(); });
  attachEngineListeners();
}

QueueManager::~QueueManager() {
  loop_.clearTimer(clock_);
  engine_.complete.disconnect(connComplete_);
  engine_.error.disconnect(connError_);
  engine_.paused.disconnect(connPaused_);
  engine_.cancelled.disconnect(connCancelled_);
}

bool QueueManager::scheduleClosed() const {
  const json schedule = settings_ ? settings_->get(ZDM_STR("schedule")) : json();
  return !inSchedule(schedule, std::chrono::system_clock::now());
}

void QueueManager::enforceSchedule() {
  if (scheduleClosed()) {
    const auto snapshot = running_;
    for (const auto& id : snapshot) {
      if (EngineTask* task = engine_.getTask(id)) task->heldBySchedule = true;
      if (std::find(scheduleHeld_.begin(), scheduleHeld_.end(), id) == scheduleHeld_.end()) {
        scheduleHeld_.push_back(id);
      }
      engine_.pause(id);  // may synchronously fire 'paused' -> freeSlot()
    }
    return;
  }
  const auto snapshot = scheduleHeld_;
  for (const auto& id : snapshot) {
    eraseValue(scheduleHeld_, id);
    EngineTask* task = engine_.getTask(id);
    if (task && task->heldBySchedule && task->status == ZDM_STR("paused")) {
      task->heldBySchedule = false;
      engine_.resume(id);
    }
  }
}

void QueueManager::release() {
  if (!held_) return;
  held_ = false;
  process();
}

void QueueManager::attachEngineListeners() {
  connComplete_ = engine_.complete.connect([this](const std::string& id) {
    eraseValue(running_, id);
    taskComplete.emit(id);
    process();
  });
  connError_ = engine_.error.connect([this](const std::string& id) {
    eraseValue(running_, id);
    taskError.emit(id);
    process();
  });
  connPaused_ = engine_.paused.connect([this](const std::string& id) { freeSlot(id); });
  connCancelled_ = engine_.cancelled.connect([this](const std::string& id) { freeSlot(id); });
}

void QueueManager::freeSlot(const std::string& id) {
  if (std::find(running_.begin(), running_.end(), id) != running_.end()) {
    eraseValue(running_, id);
    process();
  }
}

void QueueManager::setMaxConcurrent(int n) {
  // 0 and any negative value mean no limit, matching queue/manager.js.
  maxConcurrent_ = (n <= 0) ? kUnlimited : static_cast<std::size_t>(n);
  process();
}

void QueueManager::enqueue(const Record& record) {
  const std::string id = idOf(record);
  queue_.erase(std::remove_if(queue_.begin(), queue_.end(),
                              [&](const Record& r) { return idOf(r) == id; }),
               queue_.end());
  eraseValue(running_, id);
  queue_.push_back(record);
  process();
}

void QueueManager::process() {
  enforceSchedule();
  if (held_ || scheduleClosed()) return;
  while (running_.size() < maxConcurrent_ && !queue_.empty()) {
    Record record = std::move(queue_.front());
    queue_.pop_front();
    running_.push_back(idOf(record));
    started.emit(record);
    engine_.add(record);
  }
}

// The JS loop `while (queue.length && running < max) this._process()` spins forever when the
// queue is held or the schedule is closed (process() then dequeues nothing). process() already
// loops until the queue is empty or the limit is reached, so a single call is equivalent.
void QueueManager::startAll() { process(); }

void QueueManager::stopAll() {
  const auto snapshot = running_;
  for (const auto& id : snapshot) engine_.pause(id);
}

}  // namespace dm
