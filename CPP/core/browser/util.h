// util.h — small portable helpers shared by the ZDM extension installer.
#pragma once

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

namespace zdm {

namespace fs = std::filesystem;
using Bytes = std::vector<std::uint8_t>;

// UTF-8 text of a path. Works in C++17 and C++20 (where u8string() returns char8_t).
inline std::string u8(const fs::path& p) {
#if defined(__cpp_lib_char8_t)
  const auto s = p.u8string();
  return std::string(s.begin(), s.end());
#else
  return p.u8string();
#endif
}

inline std::string lowerAscii(std::string s) {
  for (char& c : s) {
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  }
  return s;
}

inline std::string trim(const std::string& s) {
  const char* ws = " \t\r\n\f\v";
  const auto b = s.find_first_not_of(ws);
  if (b == std::string::npos) return {};
  const auto e = s.find_last_not_of(ws);
  return s.substr(b, e - b + 1);
}

inline bool readFileBytes(const fs::path& p, Bytes& out) {
  std::ifstream in(p, std::ios::binary);
  if (!in) return false;
  out.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
  return true;
}

inline bool readFileText(const fs::path& p, std::string& out) {
  std::ifstream in(p, std::ios::binary);
  if (!in) return false;
  out.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
  return true;
}

// Throws std::runtime_error when the file cannot be written.
inline void writeFileBytes(const fs::path& p, const void* data, std::size_t size) {
  std::ofstream out(p, std::ios::binary | std::ios::trunc);
  if (!out) throw std::runtime_error("Cannot write " + u8(p));
  out.write(static_cast<const char*>(data), static_cast<std::streamsize>(size));
  if (!out) throw std::runtime_error("Cannot write " + u8(p));
}

inline void writeFileBytes(const fs::path& p, const Bytes& data) {
  writeFileBytes(p, data.data(), data.size());
}

inline void writeFileText(const fs::path& p, const std::string& text) {
  writeFileBytes(p, text.data(), text.size());
}

}  // namespace zdm
