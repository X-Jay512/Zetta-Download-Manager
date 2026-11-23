#include "event_loop.h"

#include <algorithm>

namespace dm {

EventLoop::TimerId EventLoop::addTimer(Ms delay, Ms interval, Task task) {
  std::lock_guard<std::mutex> lock(mutex_);
  const TimerId id = ++nextId_;
  timers_.push_back({id, Clock::now() + std::max(delay, Ms(0)), interval, std::move(task)});
  cv_.notify_all();
  return id;
}

EventLoop::TimerId EventLoop::setTimeout(Ms delay, Task task) {
  return addTimer(delay, Ms(0), std::move(task));
}

EventLoop::TimerId EventLoop::setInterval(Ms interval, Task task) {
  if (interval.count() < 1) interval = Ms(1);
  return addTimer(interval, interval, std::move(task));
}

void EventLoop::clearTimer(TimerId id) {
  if (id == 0) return;
  std::lock_guard<std::mutex> lock(mutex_);
  timers_.erase(std::remove_if(timers_.begin(), timers_.end(),
                               [id](const Timer& t) { return t.id == id; }),
                timers_.end());
}

void EventLoop::post(Task task) {
  std::lock_guard<std::mutex> lock(mutex_);
  posted_.push_back(std::move(task));
  cv_.notify_all();
}

void EventLoop::stop() {
  std::lock_guard<std::mutex> lock(mutex_);
  stop_ = true;
  cv_.notify_all();
}

void EventLoop::run() {
  std::unique_lock<std::mutex> lock(mutex_);
  while (!stop_) {
    if (!posted_.empty()) {
      Task task = std::move(posted_.front());
      posted_.pop_front();
      lock.unlock();
      task();
      lock.lock();
      continue;
    }
    auto next = std::min_element(timers_.begin(), timers_.end(),
                                 [](const Timer& a, const Timer& b) { return a.when < b.when; });
    if (next == timers_.end()) {
      cv_.wait(lock);
      continue;
    }
    if (next->when > Clock::now()) {
      cv_.wait_until(lock, next->when);
      continue;
    }
    Task task = next->task;  // copy: the callback may clear its own timer
    if (next->interval.count() > 0) next->when = Clock::now() + next->interval;
    else timers_.erase(next);
    lock.unlock();
    task();
    lock.lock();
  }
  stop_ = false;  // allow run() to be called again
}

}  // namespace dm
