#pragma once
// The download engine (../engine/*.js) was not included in the files you sent, so
// QueueManager talks to it through this interface. Implement it with your real engine.

#include <string>

#include "dm_signal.h"
#include "util.h"

namespace dm {

// What QueueManager reads/writes on engine.getTask(id).
struct EngineTask {
  std::string status;  // e.g. "paused", "downloading", ...
  bool heldBySchedule = false;
};

class IEngine {
 public:
  virtual ~IEngine() = default;

  virtual void add(const Record& record) = 0;
  virtual void pause(const std::string& id) = 0;
  virtual void resume(const std::string& id) = 0;
  // Optional in the JS version (`this.engine.getTask && ...`): return nullptr when unknown.
  virtual EngineTask* getTask(const std::string& /*id*/) { return nullptr; }

  // engine.on('complete' | 'error' | 'paused' | 'cancelled', (id) => ...)
  Signal<const std::string&> complete;
  Signal<const std::string&> error;
  Signal<const std::string&> paused;
  Signal<const std::string&> cancelled;
};

}  // namespace dm
