#pragma once
// Replacement for Node's EventEmitter: one Signal per event name.
//   JS : emitter.on('complete', (id) => ...)      emitter.emit('complete', id)
//   C++: emitter.complete.connect([](const std::string& id) { ... });
//        emitter.complete.emit(id);
// Signals are NOT thread-safe on purpose: connect and emit on the EventLoop thread.

#include <algorithm>
#include <cstddef>
#include <functional>
#include <utility>
#include <vector>

namespace dm {

template <typename... Args>
class Signal {
 public:
  using Slot = std::function<void(Args...)>;
  using Connection = std::size_t;

  Connection connect(Slot slot) {
    slots_.emplace_back(++nextId_, std::move(slot));
    return nextId_;
  }

  void disconnect(Connection id) {
    slots_.erase(std::remove_if(slots_.begin(), slots_.end(),
                                [id](const auto& s) { return s.first == id; }),
                 slots_.end());
  }

#ifdef emit
#pragma push_macro("emit")
#undef emit
#define DM_SIGNAL_RESTORE_EMIT
#endif
  void emit(Args... args) const {
    auto snapshot = slots_;  // listeners may connect/disconnect while we emit
    for (auto& s : snapshot) s.second(args...);
  }
#ifdef DM_SIGNAL_RESTORE_EMIT
#pragma pop_macro("emit")
#undef DM_SIGNAL_RESTORE_EMIT
#endif

 private:
  std::vector<std::pair<Connection, Slot>> slots_;
  Connection nextId_ = 0;
};

}  // namespace dm
