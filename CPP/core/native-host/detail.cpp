#include "zdm_str.hpp"
#include "detail.h"

#include <chrono>
#include <cstdio>
#include <filesystem>
#include <random>

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

namespace zdm {
namespace {

std::string base36(unsigned value, int width) {
  static const char* digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  std::string out(static_cast<size_t>(width), '0');
  for (int i = width - 1; i >= 0; --i) {
    out[static_cast<size_t>(i)] = digits[value % 36];
    value /= 36;
  }
  return out;
}

}  // namespace

std::wstring widen(const std::string& text) {
  if (text.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
  std::wstring out(size > 0 ? static_cast<size_t>(size) : 0, L'\0');
  if (size > 0) MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), size);
  return out;
}

std::string narrow(const std::wstring& text) {
  if (text.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
  std::string out(size > 0 ? static_cast<size_t>(size) : 0, '\0');
  if (size > 0) WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), size, nullptr, nullptr);
  return out;
}

std::string makeId() {
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::system_clock::now().time_since_epoch())
                      .count();
  std::random_device device;
  std::mt19937 rng(device());
  std::uniform_int_distribution<unsigned> dist(0, 36u * 36u * 36u * 36u - 1);
  return std::to_string(ms) + "-" + base36(dist(rng), 4) + base36(dist(rng), 4);
}

std::string jstr(const nlohmann::json& object, const char* key) {
  if (!object.is_object() || !object.contains(key) || object[key].is_null()) return {};
  if (object[key].is_string()) return object[key].get<std::string>();
  if (object[key].is_number()) return object[key].dump();
  if (object[key].is_boolean()) return object[key].get<bool>() ? ZDM_STR("true") : ZDM_STR("false");
  return {};
}

double jnum(const nlohmann::json& object, const char* key) {
  if (!object.is_object() || !object.contains(key) || object[key].is_null()) return 0;
  if (object[key].is_number()) return object[key].get<double>();
  if (object[key].is_string()) {
    try {
      return std::stod(object[key].get<std::string>());
    } catch (...) {
      return 0;
    }
  }
  return 0;
}

Tri jtri(const nlohmann::json& object, const char* key) {
  if (!object.is_object() || !object.contains(key) || object[key].is_null()) return Tri::Absent;
  if (object[key].is_boolean()) return object[key].get<bool>() ? Tri::Yes : Tri::No;
  if (object[key].is_number()) return object[key].get<double>() != 0 ? Tri::Yes : Tri::No;
  if (object[key].is_string()) return object[key].get<std::string>().empty() ? Tri::No : Tri::Yes;
  return Tri::Yes;
}

std::string writeNetscapeCookieFile(const std::string& url, const std::string& cookies,
                                    const std::string& namePrefix, bool randomSuffix,
                                    bool semicolonSpaceOnly, const std::string& domainFallback) {
  if (cookies.empty()) return {};
  std::string domain = domainFallback;
  const auto scheme = url.find("://");
  if (scheme != std::string::npos) {
    const auto hostStart = scheme + 3;
    auto hostEnd = url.find_first_of("/?#", hostStart);
    if (hostEnd == std::string::npos) hostEnd = url.size();
    domain = url.substr(hostStart, hostEnd - hostStart);
    const auto colon = domain.find(':');
    if (colon != std::string::npos) domain.resize(colon);
    if (domain.rfind(ZDM_STR("www."), 0) == 0) domain.erase(0, 4);
  }

  std::string text = ZDM_STR("# Netscape HTTP Cookie File\n");
  std::size_t cursor = 0;
  while (cursor <= cookies.size()) {
    std::size_t next = std::string::npos;
    std::size_t skip = 0;
    if (semicolonSpaceOnly) {
      next = cookies.find("; ", cursor);
      skip = 2;
    } else {
      next = cookies.find(';', cursor);
      skip = 1;
      if (next != std::string::npos) {
        while (next + skip < cookies.size() &&
               (cookies[next + skip] == ' ' || cookies[next + skip] == '\t')) {
          ++skip;
        }
      }
    }
    const std::string pair = cookies.substr(cursor, next == std::string::npos ? std::string::npos : next - cursor);
    const auto eq = pair.find('=');
    if (eq != std::string::npos && eq >= 1) {
      text += "." + domain + ZDM_STR("\tTRUE\t/\tTRUE\t0\t") + pair.substr(0, eq) + "\t" + pair.substr(eq + 1) + "\n";
    }
    if (next == std::string::npos) break;
    cursor = next + skip;
  }

  wchar_t temp[MAX_PATH];
  const DWORD n = GetTempPathW(MAX_PATH, temp);
  if (n == 0 || n >= MAX_PATH) return {};
  std::string name = namePrefix + std::to_string(
      std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count());
  if (randomSuffix) name += "_" + makeId();
  name += ".txt";
  const std::filesystem::path file = std::filesystem::path(temp) / widen(name);
  const std::string bytes = text;
  FILE* out = nullptr;
  if (_wfopen_s(&out, file.c_str(), L"wb") != 0 || !out) return {};
  std::fwrite(bytes.data(), 1, bytes.size(), out);
  std::fclose(out);
  return narrow(file.wstring());
}

void deleteFileQuiet(const std::string& path) {
  if (path.empty()) return;
  std::error_code error;
  std::filesystem::remove(std::filesystem::u8path(path), error);
}

}  // namespace zdm
