#pragma once
// Shared helpers for the native-host port. Not used by the program.

#include <cstdint>
#include <string>

#include <nlohmann/json.hpp>

namespace zdm {

std::wstring widen(const std::string& text);
std::string narrow(const std::wstring& text);
std::string makeId();

std::string jstr(const nlohmann::json& object, const char* key);
double jnum(const nlohmann::json& object, const char* key);
inline std::string jstr(const nlohmann::json& object, const std::string& key) { return jstr(object, key.c_str()); }
inline double jnum(const nlohmann::json& object, const std::string& key) { return jnum(object, key.c_str()); }

enum class Tri { Absent, No, Yes };
Tri jtri(const nlohmann::json& object, const char* key);
inline Tri jtri(const nlohmann::json& object, const std::string& key) { return jtri(object, key.c_str()); }

// Netscape cookie file. Empty cookies return an empty path and write nothing.
// semicolonSpaceOnly splits on the two characters "; " (server.js).
// Otherwise the split is ";' plus following whitespace (formats-for.js).
std::string writeNetscapeCookieFile(const std::string& url, const std::string& cookies,
                                    const std::string& namePrefix, bool randomSuffix,
                                    bool semicolonSpaceOnly, const std::string& domainFallback);
void deleteFileQuiet(const std::string& path);

}  // namespace zdm
