#include "zdm_str.hpp"
#include "schedule.h"

#include <optional>

namespace dm {

namespace {
std::optional<int> minutesOfDay(const std::string& hhmm) {
  const auto colon = hhmm.find(':');
  if (colon == std::string::npos) return std::nullopt;
  try {
    return std::stoi(hhmm.substr(0, colon)) * 60 + std::stoi(hhmm.substr(colon + 1));
  } catch (...) {
    return std::nullopt;
  }
}
}  // namespace

bool inSchedule(const json& schedule, std::chrono::system_clock::time_point when) {
  if (!schedule.is_object() || !truthy(member(schedule, ZDM_STR("enabled")))) return true;

  const std::tm tm = localTime(std::chrono::system_clock::to_time_t(when));

  const json days = member(schedule, ZDM_STR("days"));
  if (days.is_array()) {
    bool allowed = false;
    for (const auto& d : days) {
      if (d.is_number() && static_cast<int>(d.get<double>()) == tm.tm_wday) allowed = true;
    }
    if (!allowed) return false;
  }

  const auto start = minutesOfDay(stringOr(member(schedule, ZDM_STR("start")), "00:00"));
  const auto end = minutesOfDay(stringOr(member(schedule, ZDM_STR("end")), "23:59"));
  if (!start || !end) return true;

  const int now = tm.tm_hour * 60 + tm.tm_min;
  if (*start <= *end) return now >= *start && now <= *end;
  return now >= *start || now <= *end;  // window crossing midnight
}

}  // namespace dm
