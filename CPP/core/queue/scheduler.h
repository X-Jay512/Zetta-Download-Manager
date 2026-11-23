#pragma once
// scheduler.js -> Scheduler: one-shot / repeating jobs that fire a 'trigger' signal.

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "event_loop.h"
#include "dm_signal.h"
#include "util.h"

namespace dm {

struct Job {
  std::string id;
  std::string scheduledAt;            // ISO-8601, e.g. "2026-11-01T20:00:00.000Z"
  bool repeat = false;
  std::int64_t repeatInterval = 0;    // milliseconds
  json data;                          // any extra payload the JS job object carried
};

class Scheduler {
 public:
  explicit Scheduler(EventLoop& loop) : loop_(loop) {}
  ~Scheduler() { destroy(); }
  Scheduler(const Scheduler&) = delete;
  Scheduler& operator=(const Scheduler&) = delete;

  void add(Job job);
  void remove(const std::string& id);
  std::vector<Job> getAll() const { return jobs_; }
  void destroy();

  Signal<const Job&> trigger;  // emitter.emit('trigger', job)

 private:
  void schedule(const std::string& id);
  void onTimer(const std::string& id);
  std::vector<Job>::iterator find(const std::string& id);

  EventLoop& loop_;
  std::vector<Job> jobs_;  // insertion order, like a JS Map
  std::unordered_map<std::string, EventLoop::TimerId> timers_;
};

}  // namespace dm
