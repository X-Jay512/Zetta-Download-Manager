#pragma once
// Minimal single-threaded event loop that mimics Node's timers.
//   setTimeout / setInterval / clearTimeout  ->  setTimeout / setInterval / clearTimer
// All callbacks run on the thread that calls run(), so the modules built on top of it
// (Scheduler, QueueManager, ...) need no locking, exactly like their JS originals.
// Worker threads talk to the loop through post(), which is thread-safe.

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <vector>

namespace dm {

class EventLoop {
 public:
  using Task = std::function<void()>;
  using TimerId = std::uint64_t;
  using Ms = std::chrono::milliseconds;

  TimerId setTimeout(Ms delay, Task task);
  TimerId setInterval(Ms interval, Task task);
  void clearTimer(TimerId id);  // safe with id == 0 or an already-fired timer

  void post(Task task);  // thread-safe: run `task` on the loop thread
  void run();            // blocks until stop() is called
  void stop();           // thread-safe

 private:
  using Clock = std::chrono::steady_clock;
  struct Timer {
    TimerId id;
    Clock::time_point when;
    Ms interval;  // 0 => one-shot
    Task task;
  };

  TimerId addTimer(Ms delay, Ms interval, Task task);

  std::mutex mutex_;
  std::condition_variable cv_;
  std::deque<Task> posted_;
  std::vector<Timer> timers_;
  TimerId nextId_ = 0;
  bool stop_ = false;
};

}  // namespace dm
