#pragma once
// Port of core/native-host/host.js.
// Chrome speaks native-messaging frames on stdin/stdout. This process forwards
// them, one JSON line each, to the named pipe. Nothing in the program launches it.

#include "zdm_str.hpp"

namespace zdm {

inline const char* kNativePipePath() { return ZDM_STR("\\\\.\\pipe\\private"); }

// Blocks until stdin closes. Returns 0.
int runHostBridge();

}  // namespace zdm
