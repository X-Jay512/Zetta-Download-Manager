#include "zdm_str.hpp"
#include "util.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <random>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>
#endif

namespace dm {

// ---------------------------------------------------------------- JS semantics
bool truthy(const json& v) {
  switch (v.type()) {
    case json::value_t::null: return false;
    case json::value_t::boolean: return v.get<bool>();
    case json::value_t::string: return !v.get_ref<const std::string&>().empty();
    case json::value_t::number_integer: return v.get<std::int64_t>() != 0;
    case json::value_t::number_unsigned: return v.get<std::uint64_t>() != 0;
    case json::value_t::number_float: {
      const double d = v.get<double>();
      return d != 0.0 && !std::isnan(d);
    }
    default: return true;  // objects and arrays are truthy in JS, even when empty
  }
}

json member(const json& obj, const std::string& key) {
  if (obj.is_object()) {
    auto it = obj.find(key);
    if (it != obj.end()) return *it;
  }
  return json();
}

std::string stringOr(const json& v, const std::string& def) {
  return v.is_string() ? v.get<std::string>() : def;
}

double toNumber(const json& v) {
  if (v.is_number()) return v.get<double>();
  if (v.is_boolean()) return v.get<bool>() ? 1.0 : 0.0;
  if (v.is_null()) return 0.0;
  if (v.is_string()) {
    const std::string s = trim(v.get<std::string>());
    if (s.empty()) return 0.0;
    char* end = nullptr;
    const double d = std::strtod(s.c_str(), &end);
    return (end && *end == '\0') ? d : std::nan("");
  }
  return std::nan("");
}

json numberJson(double d) {
  if (std::isfinite(d) && d == std::floor(d) && std::fabs(d) < 9e15) {
    return static_cast<std::int64_t>(d);
  }
  return d;
}

// --------------------------------------------------------------------- strings
std::string toLower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return s;
}

std::string trim(const std::string& s) {
  const char* ws = " \t\n\r\f\v";
  const auto first = s.find_first_not_of(ws);
  if (first == std::string::npos) return {};
  const auto last = s.find_last_not_of(ws);
  return s.substr(first, last - first + 1);
}

// ------------------------------------------------------------------------ time
namespace {

// Howard Hinnant's civil-calendar algorithms (public domain).
std::int64_t daysFromCivil(std::int64_t y, unsigned m, unsigned d) {
  y -= m <= 2;
  const std::int64_t era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = static_cast<unsigned>(y - era * 400);
  const unsigned doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + static_cast<std::int64_t>(doe) - 719468;
}

void civilFromDays(std::int64_t z, int& y, unsigned& m, unsigned& d) {
  z += 719468;
  const std::int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = static_cast<unsigned>(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const std::int64_t y0 = static_cast<std::int64_t>(yoe) + era * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  d = doy - (153 * mp + 2) / 5 + 1;
  m = mp < 10 ? mp + 3 : mp - 9;
  y = static_cast<int>(y0 + (m <= 2 ? 1 : 0));
}

std::int64_t floorDiv(std::int64_t a, std::int64_t b) {
  std::int64_t q = a / b;
  if ((a % b != 0) && ((a < 0) != (b < 0))) --q;
  return q;
}

bool readDigits(const std::string& s, std::size_t& i, int count, int& out) {
  if (i + static_cast<std::size_t>(count) > s.size()) return false;
  int v = 0;
  for (int k = 0; k < count; ++k) {
    const char c = s[i + static_cast<std::size_t>(k)];
    if (c < '0' || c > '9') return false;
    v = v * 10 + (c - '0');
  }
  i += static_cast<std::size_t>(count);
  out = v;
  return true;
}

bool readChar(const std::string& s, std::size_t& i, char c) {
  if (i < s.size() && s[i] == c) {
    ++i;
    return true;
  }
  return false;
}

}  // namespace

std::int64_t nowMs() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

std::string toIsoString(std::int64_t epochMs) {
  const std::int64_t secs = floorDiv(epochMs, 1000);
  const int msPart = static_cast<int>(epochMs - secs * 1000);
  const std::int64_t days = floorDiv(secs, 86400);
  const int sod = static_cast<int>(secs - days * 86400);
  int y = 0;
  unsigned m = 0, d = 0;
  civilFromDays(days, y, m, d);
  char buf[48];
  std::snprintf(buf, sizeof buf, "%04d-%02u-%02uT%02d:%02d:%02d.%03dZ", y, m, d, sod / 3600,
                (sod / 60) % 60, sod % 60, msPart);
  return buf;
}

std::string isoNow() { return toIsoString(nowMs()); }

std::optional<std::int64_t> parseIsoString(const std::string& text) {
  const std::string s = trim(text);
  std::size_t i = 0;
  int Y = 0, M = 0, D = 0, h = 0, mi = 0, sec = 0, ms = 0;
  if (!readDigits(s, i, 4, Y) || !readChar(s, i, '-') || !readDigits(s, i, 2, M) ||
      !readChar(s, i, '-') || !readDigits(s, i, 2, D)) {
    return std::nullopt;
  }
  if (M < 1 || M > 12 || D < 1 || D > 31) return std::nullopt;
  const std::int64_t dayMs = daysFromCivil(Y, static_cast<unsigned>(M), static_cast<unsigned>(D)) * 86400000LL;
  if (i == s.size()) return dayMs;  // date only => UTC midnight (same as JS)

  if (!readChar(s, i, 'T') && !readChar(s, i, ' ')) return std::nullopt;
  if (!readDigits(s, i, 2, h) || !readChar(s, i, ':') || !readDigits(s, i, 2, mi)) return std::nullopt;
  if (readChar(s, i, ':')) {
    if (!readDigits(s, i, 2, sec)) return std::nullopt;
    if (readChar(s, i, '.')) {
      int digits = 0;
      while (i < s.size() && s[i] >= '0' && s[i] <= '9') {
        if (digits < 3) ms = ms * 10 + (s[i] - '0');
        ++digits;
        ++i;
      }
      if (digits == 0) return std::nullopt;
      for (int k = digits; k < 3; ++k) ms *= 10;
    }
  }
  const std::int64_t utcAsIfLocal = dayMs + ((h * 60LL + mi) * 60 + sec) * 1000 + ms;

  if (i == s.size()) {  // no offset => local time (same as JS)
    std::tm tm{};
    tm.tm_year = Y - 1900;
    tm.tm_mon = M - 1;
    tm.tm_mday = D;
    tm.tm_hour = h;
    tm.tm_min = mi;
    tm.tm_sec = sec;
    tm.tm_isdst = -1;
    const std::time_t t = std::mktime(&tm);
    if (t == static_cast<std::time_t>(-1)) return std::nullopt;
    return static_cast<std::int64_t>(t) * 1000 + ms;
  }
  if (readChar(s, i, 'Z')) {
    if (i != s.size()) return std::nullopt;
    return utcAsIfLocal;
  }
  int sign = 0;
  if (readChar(s, i, '+')) sign = 1;
  else if (readChar(s, i, '-')) sign = -1;
  else return std::nullopt;
  int oh = 0, om = 0;
  if (!readDigits(s, i, 2, oh)) return std::nullopt;
  readChar(s, i, ':');
  if (!readDigits(s, i, 2, om) || i != s.size()) return std::nullopt;
  return utcAsIfLocal - sign * (oh * 60LL + om) * 60000LL;
}

std::tm localTime(std::time_t t) {
  std::tm out{};
#ifdef _WIN32
  localtime_s(&out, &t);
#else
  localtime_r(&t, &out);
#endif
  return out;
}

// ------------------------------------------------------------------- ids/paths
std::string generateUuid() {
  static thread_local std::mt19937_64 rng{std::random_device{}()};
  std::uint64_t a = rng(), b = rng();
  a = (a & 0xFFFFFFFFFFFF0FFFULL) | 0x0000000000004000ULL;  // version 4
  b = (b & 0x3FFFFFFFFFFFFFFFULL) | 0x8000000000000000ULL;  // RFC 4122 variant
  char buf[40];
  std::snprintf(buf, sizeof buf, "%08x-%04x-%04x-%04x-%012llx",
                static_cast<unsigned>(a >> 32), static_cast<unsigned>((a >> 16) & 0xFFFF),
                static_cast<unsigned>(a & 0xFFFF), static_cast<unsigned>(b >> 48),
                static_cast<unsigned long long>(b & 0xFFFFFFFFFFFFULL));
  return buf;
}

fs::path pathFromUtf8(const std::string& s) { return fs::u8path(s); }

std::string pathToUtf8(const fs::path& p) {
  const auto s = p.u8string();  // std::string in C++17, std::u8string in C++20
  return std::string(s.begin(), s.end());
}

std::string joinPath(const std::string& base, const std::string& leaf) {
  // relative_path() so an absolute `leaf` is appended instead of replacing `base` (like path.join).
  return pathToUtf8(pathFromUtf8(base) / pathFromUtf8(leaf).relative_path());
}

fs::path homeDir() {
#ifdef _WIN32
  if (const char* p = std::getenv("USERPROFILE")) return pathFromUtf8(p);
  const char* drive = std::getenv("HOMEDRIVE");
  const char* path = std::getenv("HOMEPATH");
  if (drive && path) return pathFromUtf8(std::string(drive) + path);
#else
  if (const char* p = std::getenv("HOME")) return pathFromUtf8(p);
#endif
  return fs::current_path();
}

fs::path exeDir() {
#ifdef _WIN32
  std::wstring buf(32768, L'\0');
  const DWORD n = GetModuleFileNameW(nullptr, buf.data(), static_cast<DWORD>(buf.size()));
  if (n > 0 && n < buf.size()) {
    buf.resize(n);
    return fs::path(buf).parent_path();
  }
#elif defined(__APPLE__)
  std::uint32_t size = 0;
  _NSGetExecutablePath(nullptr, &size);
  std::string buf(size, '\0');
  if (_NSGetExecutablePath(buf.data(), &size) == 0) return fs::path(buf.c_str()).parent_path();
#else
  std::error_code ec;
  const fs::path p = fs::read_symlink("/proc/self/exe", ec);
  if (!ec) return p.parent_path();
#endif
  return fs::current_path();
}

std::string getBinPath(const std::string& name) {
  std::error_code ec;
  const fs::path candidate = exeDir() / ZDM_STR("bin") / pathFromUtf8(name);
  if (fs::exists(candidate, ec)) return pathToUtf8(candidate);
  return name;
}

#ifdef _WIN32
std::wstring utf8ToWide(const std::string& s) {
  if (s.empty()) return {};
  const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
  std::wstring w(static_cast<std::size_t>(n), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
  return w;
}

std::string wideToUtf8(const std::wstring& w) {
  if (w.empty()) return {};
  const int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
  std::string s(static_cast<std::size_t>(n), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), s.data(), n, nullptr, nullptr);
  return s;
}
#endif

}  // namespace dm
