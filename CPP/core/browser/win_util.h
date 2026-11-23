// win_util.h — Windows-only helpers (UTF-8 <-> UTF-16, %VAR% expansion, full paths).
#pragma once

#ifndef _WIN32
#error "win_util.h is Windows-only"
#endif

#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <algorithm>
#include <string>

#include "util.h"

namespace zdm {

inline std::string toUtf8(const std::wstring& w) {
  if (w.empty()) return {};
  const int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
  std::string s(static_cast<size_t>(n), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), &s[0], n, nullptr, nullptr);
  return s;
}

inline std::wstring toWide(const std::string& s) {
  if (s.empty()) return {};
  const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
  std::wstring w(static_cast<size_t>(n), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), &w[0], n);
  return w;
}

inline std::wstring lowerW(std::wstring s) {
  if (!s.empty()) CharLowerBuffW(&s[0], static_cast<DWORD>(s.size()));
  return s;
}

inline bool equalsNoCase(const std::wstring& a, const std::wstring& b) {
  return CompareStringOrdinal(a.c_str(), static_cast<int>(a.size()), b.c_str(), static_cast<int>(b.size()), TRUE) ==
         CSTR_EQUAL;
}

inline bool startsWithNoCase(const std::wstring& s, const std::wstring& prefix) {
  return s.size() >= prefix.size() && equalsNoCase(s.substr(0, prefix.size()), prefix);
}

// Same behaviour as the Node helper: "%NAME%" becomes the variable's value, unknown names become "".
inline std::wstring expandEnv(const std::wstring& raw) {
  std::wstring out;
  size_t i = 0;
  while (i < raw.size()) {
    if (raw[i] == L'%') {
      const size_t j = raw.find(L'%', i + 1);
      if (j != std::wstring::npos && j > i + 1) {
        const std::wstring name = raw.substr(i + 1, j - i - 1);
        const DWORD need = GetEnvironmentVariableW(name.c_str(), nullptr, 0);
        if (need > 0) {
          std::wstring value(need, L'\0');
          const DWORD got = GetEnvironmentVariableW(name.c_str(), &value[0], need);
          value.resize(got);
          out += value;
        }
        i = j + 1;
        continue;
      }
    }
    out += raw[i++];
  }
  return out;
}

// Equivalent of Node's path.resolve() on Windows, without a trailing slash (except for a drive root).
inline std::wstring fullPath(const std::wstring& raw) {
  std::wstring in = raw;
  std::replace(in.begin(), in.end(), L'/', L'\\');
  const DWORD need = GetFullPathNameW(in.c_str(), 0, nullptr, nullptr);
  if (need == 0) return in;
  std::wstring out(need, L'\0');
  const DWORD got = GetFullPathNameW(in.c_str(), need, &out[0], nullptr);
  out.resize(got);
  while (out.size() > 3 && (out.back() == L'\\' || out.back() == L'/')) out.pop_back();
  return out;
}

inline std::wstring winErrorText(DWORD code) {
  wchar_t* buf = nullptr;
  const DWORD n = FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                                 nullptr, code, 0, reinterpret_cast<LPWSTR>(&buf), 0, nullptr);
  std::wstring text = (n && buf) ? std::wstring(buf, n) : L"Unknown error";
  if (buf) LocalFree(buf);
  while (!text.empty() && (text.back() == L'\r' || text.back() == L'\n' || text.back() == L' ')) text.pop_back();
  return text;
}

// Directory that contains the running executable (the Node version used __dirname).
inline fs::path moduleDir() {
  std::wstring buf(32768, L'\0');
  const DWORD n = GetModuleFileNameW(nullptr, &buf[0], static_cast<DWORD>(buf.size()));
  buf.resize(n);
  return fs::path(buf).parent_path();
}

}  // namespace zdm
