// browsers.cpp — C++17 port of browsers.js
#include "win_util.h"

#include "browsers.h"

#include <cwchar>
#include <map>
#include <mutex>
#include <regex>
#include <set>

namespace zdm {
namespace {

struct Candidate {
  std::wstring name;
  fs::path exe;
  std::string id;  // empty when the id has to be derived
};

std::mutex g_exeMutex;
std::map<std::string, fs::path> g_exeById;

bool fileExists(const std::wstring& raw) {
  const std::wstring full = expandEnv(raw);
  if (full.empty() || full.find(L'%') != std::wstring::npos) return false;
  std::error_code ec;
  return fs::exists(fs::path(full), ec);
}

bool hasFile(const fs::path& dir, const wchar_t* name) {
  std::error_code ec;
  return fs::exists(dir / name, ec);
}

struct StoreInfo {
  std::string store, storeName, storeUrl;
};

StoreInfo storeFor(const std::string& family) {
  if (family == "firefox") return {"firefox", "Firefox Add-ons", kFirefoxStoreUrl()};
  if (family == "chromium") return {"chrome", "Chrome Web Store", kChromeStoreUrl()};
  return {"", "", ""};
}

std::string slug(const std::wstring& value) {
  std::string out;
  bool pendingDash = false;
  for (wchar_t raw : lowerW(value)) {
    const bool keep = (raw >= L'a' && raw <= L'z') || (raw >= L'0' && raw <= L'9');
    if (keep) {
      if (pendingDash && !out.empty()) out += '-';
      pendingDash = false;
      out += static_cast<char>(raw);
    } else {
      pendingDash = true;
    }
  }
  if (out.size() > 40) out.resize(40);
  while (!out.empty() && out.back() == '-') out.pop_back();
  return out;
}

bool contains(const std::wstring& hay, const wchar_t* needle) { return hay.find(needle) != std::wstring::npos; }

bool endsWith(const std::wstring& s, const std::wstring& tail) {
  return s.size() >= tail.size() && s.compare(s.size() - tail.size(), tail.size(), tail) == 0;
}

std::string stableId(const fs::path& exe, const std::wstring& displayName) {
  fs::path normal = exe.lexically_normal();
  normal.make_preferred();
  const std::wstring lower = lowerW(normal.wstring());

  if (contains(lower, L"\\google\\chrome beta\\") || contains(lower, L"\\google\\chrome dev\\") ||
      contains(lower, L"\\google\\chrome sxs\\")) {
    const std::string s = slug(displayName);
    return s.empty() ? "chrome-variant" : s;
  }
  if (contains(lower, L"\\google\\chrome\\")) return "chrome";
  if (endsWith(lower, L"\\msedge.exe")) return "edge";
  if (contains(lower, L"\\bravesoftware\\") || endsWith(lower, L"\\brave.exe")) return "brave";
  if (contains(lower, L"\\opera")) return "opera";
  if (contains(lower, L"\\vivaldi\\") || endsWith(lower, L"\\vivaldi.exe")) return "vivaldi";
  if (contains(lower, L"\\chromium\\")) return "chromium";
  if (endsWith(lower, L"\\firefox.exe") && contains(lower, L"\\mozilla firefox\\")) return "firefox";

  std::string s = slug(displayName);
  if (s.empty()) s = slug(exe.stem().wstring());
  return s.empty() ? "browser" : s;
}

// Reads the (Default) string of <key>\<sub>, expanding %VARS% in REG_EXPAND_SZ values.
std::optional<std::wstring> regReadDefault(HKEY key, const std::wstring& sub) {
  DWORD size = 0;
  const DWORD flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;
  if (RegGetValueW(key, sub.empty() ? nullptr : sub.c_str(), nullptr, flags, nullptr, nullptr, &size) != ERROR_SUCCESS ||
      size == 0) {
    return std::nullopt;
  }
  std::wstring buf(size / sizeof(wchar_t) + 1, L'\0');
  DWORD got = static_cast<DWORD>(buf.size() * sizeof(wchar_t));
  if (RegGetValueW(key, sub.empty() ? nullptr : sub.c_str(), nullptr, flags, nullptr, &buf[0], &got) != ERROR_SUCCESS) {
    return std::nullopt;
  }
  buf.resize(wcslen(buf.c_str()));
  return buf;
}

// HKLM/HKCU\SOFTWARE\Clients\StartMenuInternet\<client>\shell\open\command
std::vector<Candidate> registryBrowsers() {
  struct Root {
    HKEY hive;
    const wchar_t* path;
  };
  const Root roots[] = {
      {HKEY_LOCAL_MACHINE, L"SOFTWARE\\Clients\\StartMenuInternet"},
      {HKEY_LOCAL_MACHINE, L"SOFTWARE\\WOW6432Node\\Clients\\StartMenuInternet"},
      {HKEY_CURRENT_USER, L"SOFTWARE\\Clients\\StartMenuInternet"},
  };

  std::vector<Candidate> found;
  for (const Root& root : roots) {
    HKEY h = nullptr;
    if (RegOpenKeyExW(root.hive, root.path, 0, KEY_READ, &h) != ERROR_SUCCESS) continue;
    for (DWORD i = 0;; ++i) {
      wchar_t name[256];
      DWORD len = 256;
      const LONG rc = RegEnumKeyExW(h, i, name, &len, nullptr, nullptr, nullptr, nullptr);
      if (rc == ERROR_NO_MORE_ITEMS) break;
      if (rc != ERROR_SUCCESS) continue;
      const std::wstring client(name, len);
      const auto command = regReadDefault(h, client + L"\\shell\\open\\command");
      if (!command) continue;
      const fs::path exe = exeFromCommand(*command);
      if (exe.empty()) continue;
      Candidate c;
      c.name = regReadDefault(h, client).value_or(L"");
      c.exe = exe;
      found.push_back(std::move(c));
    }
    RegCloseKey(h);
  }
  return found;
}

std::vector<Candidate> knownPathBrowsers() {
  std::vector<Candidate> found;
  for (const KnownBrowser& browser : knownBrowsers()) {
    for (const std::wstring& raw : browser.paths) {
      if (!fileExists(raw)) continue;
      Candidate c;
      c.name = browser.name;
      c.exe = expandEnv(raw);
      c.id = browser.id;
      found.push_back(std::move(c));
      break;
    }
  }
  return found;
}

}  // namespace

nlohmann::json InstalledBrowser::toJson() const {
  nlohmann::json j = nlohmann::json::object();
  j["id"] = id;
  j["name"] = toUtf8(name);
  j["enabled"] = enabled;
  j["family"] = family;
  j["exe"] = u8(exe);
  j["store"] = store;
  j["storeName"] = storeName;
  j["storeUrl"] = storeUrl;
  return j;
}

const std::vector<KnownBrowser>& knownBrowsers() {
  static const std::vector<KnownBrowser> known = {
      {"chrome", L"Google Chrome",
       {L"%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
        L"%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
        L"%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"}},
      {"edge", L"Microsoft Edge",
       {L"%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe",
        L"%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"}},
      {"brave", L"Brave",
       {L"%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        L"%LocalAppData%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"}},
      {"opera", L"Opera",
       {L"%LocalAppData%\\Programs\\Opera\\opera.exe", L"%LocalAppData%\\Programs\\Opera GX\\opera.exe",
        L"%ProgramFiles%\\Opera\\opera.exe"}},
      {"firefox", L"Firefox",
       {L"%ProgramFiles%\\Mozilla Firefox\\firefox.exe", L"%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe"}},
      {"vivaldi", L"Vivaldi",
       {L"%LocalAppData%\\Vivaldi\\Application\\vivaldi.exe", L"%ProgramFiles%\\Vivaldi\\Application\\vivaldi.exe"}},
      {"chromium", L"Chromium",
       {L"%LocalAppData%\\Chromium\\Application\\chrome.exe", L"%ProgramFiles%\\Chromium\\Application\\chrome.exe"}},
  };
  return known;
}

fs::path exeFromCommand(const std::wstring& command) {
  // trim
  const size_t b = command.find_first_not_of(L" \t\r\n");
  if (b == std::wstring::npos) return {};
  const size_t e = command.find_last_not_of(L" \t\r\n");
  const std::wstring text = command.substr(b, e - b + 1);

  static const std::wregex quoted(LR"re("([^"]+\.exe)")re", std::regex::icase);
  static const std::wregex bare(LR"re(([A-Za-z]:\\.+?\.exe)\b)re", std::regex::icase);
  std::wsmatch m;
  if (std::regex_search(text, m, quoted)) return fs::path(m[1].str());
  if (std::regex_search(text, m, bare)) return fs::path(m[1].str());
  return {};
}

// Chromium and Firefox keep different files beside the program.
// The folder tells the engine, so a new fork does not need its own entry.
std::string familyOf(const fs::path& exe) {
  const fs::path dir = exe.parent_path();
  std::vector<fs::path> spots = {dir, dir.parent_path()};

  std::error_code ec;
  for (fs::directory_iterator it(dir, ec), end; !ec && it != end; it.increment(ec)) {
    std::error_code sec;
    if (!it->is_directory(sec)) continue;
    // version folders look like "123.0.6312.58"
    const std::wstring name = it->path().filename().wstring();
    size_t digits = 0;
    while (digits < name.size() && name[digits] >= L'0' && name[digits] <= L'9') ++digits;
    if (digits > 0 && digits < name.size() && name[digits] == L'.') spots.push_back(it->path());
  }

  auto has = [&](const wchar_t* name) {
    for (const fs::path& spot : spots) {
      if (hasFile(spot, name)) return true;
    }
    return false;
  };

  if (has(L"xul.dll") || has(L"omni.ja")) return "firefox";
  if (has(L"chrome.dll") || has(L"chrome_elf.dll") || has(L"msedge.dll") || has(L"libcef.dll") ||
      has(L"opera.dll") || has(L"opera_elf.dll") || has(L"snapshot_blob.bin") || has(L"icudtl.dat")) {
    return "chromium";
  }
  return "";
}

std::vector<InstalledBrowser> scanInstalledBrowsers(const std::vector<InstalledBrowser>& previous) {
  std::map<std::string, bool> prior;
  for (const InstalledBrowser& row : previous) {
    if (!row.id.empty()) prior[row.id] = row.enabled;
  }

  std::set<std::wstring> seenExe;
  std::set<std::string> usedIds;
  std::vector<InstalledBrowser> found;

  std::vector<Candidate> candidates = registryBrowsers();
  for (Candidate& c : knownPathBrowsers()) candidates.push_back(std::move(c));

  for (const Candidate& candidate : candidates) {
    fs::path exe = candidate.exe.lexically_normal();
    exe.make_preferred();
    if (!fileExists(exe.wstring())) continue;

    const std::wstring key = lowerW(exe.wstring());
    if (seenExe.count(key)) continue;

    const std::string family = familyOf(exe);
    if (family.empty()) continue;
    seenExe.insert(key);

    std::string id = !candidate.id.empty() ? candidate.id : stableId(exe, candidate.name);
    if (usedIds.count(id)) {
      if (!candidate.id.empty()) continue;
      id += "-" + std::to_string(usedIds.size() + 1);
    }
    usedIds.insert(id);
    {
      std::lock_guard<std::mutex> lock(g_exeMutex);
      g_exeById[id] = exe;
    }

    const StoreInfo store = storeFor(family);
    InstalledBrowser row;
    row.id = id;
    row.name = !candidate.name.empty() ? candidate.name : exe.stem().wstring();
    row.enabled = prior.count(id) ? prior[id] : true;
    row.family = family;
    row.exe = exe;
    row.store = store.store;
    row.storeName = store.storeName;
    row.storeUrl = store.storeUrl;
    found.push_back(std::move(row));
  }
  return found;
}

fs::path getBrowserExe(const std::string& id) {
  {
    std::lock_guard<std::mutex> lock(g_exeMutex);
    const auto it = g_exeById.find(id);
    if (it != g_exeById.end() && fileExists(it->second.wstring())) return it->second;
  }
  for (const KnownBrowser& browser : knownBrowsers()) {
    if (browser.id != id) continue;
    for (const std::wstring& raw : browser.paths) {
      const std::wstring full = expandEnv(raw);
      if (!full.empty() && full.find(L'%') == std::wstring::npos && fileExists(full)) return fs::path(full);
    }
    return {};
  }
  return {};
}

}  // namespace zdm
