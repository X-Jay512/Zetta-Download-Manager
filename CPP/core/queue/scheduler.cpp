#include "scheduler.h"

#include <algorithm>

namespace dm {

std::vector<Job>::iterator Scheduler::find(const std::string& id) {
  return std::find_if(jobs_.begin(), jobs_.end(), [&](const Job& j) { return j.id == id; });
}

void Scheduler::add(Job job) {
  const std::string id = job.id;
  // Re-adding an id replaces the job *and* its timer (the JS version leaked the old timer).
  auto old = timers_.find(id);
  if (old != timers_.end()) {
    loop_.clearTimer(old->second);
    timers_.erase(old);
  }
  auto it = find(id);
  if (it != jobs_.end()) *it = std::move(job);
  else jobs_.push_back(std::move(job));
  schedule(id);
}

void Scheduler::remove(const std::string& id) {
  auto t = timers_.find(id);
  if (t != timers_.end()) {
    loop_.clearTimer(t->second);
    timers_.erase(t);
  }
  auto it = find(id);
  if (it != jobs_.end()) jobs_.erase(it);
}

void Scheduler::schedule(const std::string& id) {
  auto it = find(id);
  if (it == jobs_.end()) return;

  // An unparsable date behaves like NaN in JS: the timer fires (almost) immediately.
  const std::int64_t target = parseIsoString(it->scheduledAt).value_or(0);
  const std::int64_t delay = std::max<std::int64_t>(0, target - nowMs());
  timers_[id] = loop_.setTimeout(EventLoop::Ms(delay), [this, id] { onTimer(id); });
}

void Scheduler::onTimer(const std::string& id) {
  auto it = find(id);
  if (it == jobs_.end()) return;
  const Job job = *it;  // listeners get a snapshot
  timers_.erase(id);    // this timer has fired

  trigger.emit(job);

  // A listener may have removed or replaced the job; in that case leave it alone.
  it = find(id);
  if (it == jobs_.end() || timers_.count(id)) return;

  if (it->repeat) {
    it->scheduledAt = toIsoString(nowMs() + it->repeatInterval);
    schedule(id);
  } else {
    jobs_.erase(it);
  }
}

void Scheduler::destroy() {
  for (auto& kv : timers_) loop_.clearTimer(kv.second);
  timers_.clear();
  jobs_.clear();
}

}  // namespace dm
