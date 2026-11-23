#pragma once
// Stand-in for require('../engine/schedule').inSchedule, which was not part of the files
// you sent. It follows the shape of settings.schedule:
//   { enabled, days: [0..6 (0 = Sunday)], start: "HH:MM", end: "HH:MM" }
// Replace the body in schedule.cpp if your original has different rules.

#include <chrono>

#include "util.h"

namespace dm {

// true  => downloads are allowed to run at `when`
bool inSchedule(const json& schedule, std::chrono::system_clock::time_point when);

}  // namespace dm
