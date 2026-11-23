#pragma once
// Small helpers that replace things JavaScript / Node gave us for free.

#include <nlohmann/json.hpp>

#include <cstdint>
#include <ctime>
#include <filesystem>
#include <optional>
#include <string>

namespace dm {

namespace fs = std::filesystem;

// ordered_json keeps keys in insertion order, exactly like JS objects,
// so settings.json / downloads.json look the same as before.
using json = nlohmann::ordered_json;
using Record = json;  // a download record (dynamic, as in the JS version)

// ---- JS semantics -----------------------------------------------------------
bool truthy(const json& v);                                   // JS truthiness
json member(const json& obj, const std::string& key);         // obj[key] or null
std::string stringOr(const json& v, const std::string& def = {});
double toNumber(const json& v);                               // JS Number(x) (NaN if invalid)
json numberJson(double d);                                    // integral doubles become ints

// ---- strings ----------------------------------------------------------------
std::string toLower(std::string s);
std::string trim(const std::string& s);                       // ASCII whitespace

// ---- time -------------------------------------------------------------------
std::int64_t nowMs();                                         // Date.now()
std::string toIsoString(std::int64_t epochMs);                // new Date(ms).toISOString()
std::string isoNow();
std::optional<std::int64_t> parseIsoString(const std::string& s);  // new Date(s).getTime()
std::tm localTime(std::time_t t);

// ---- ids / paths ------------------------------------------------------------
std::string generateUuid();                                   // uuid v4
fs::path pathFromUtf8(const std::string& s);
std::string pathToUtf8(const fs::path& p);
std::string joinPath(const std::string& base, const std::string& leaf);  // path.join
fs::path homeDir();                                           // os.homedir()
fs::path exeDir();                                            // directory of the running executable
// Stand-in for require('../bin-path').getBinPath: <exeDir>/bin/<name>, else just <name> (PATH lookup).
std::string getBinPath(const std::string& name);

#ifdef _WIN32
std::wstring utf8ToWide(const std::string& s);
std::string wideToUtf8(const std::wstring& w);
#endif

}  // namespace dm
