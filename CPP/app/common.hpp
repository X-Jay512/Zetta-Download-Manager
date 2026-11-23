#pragma once
// Shared helpers for link_refresh.hpp and duplicates.hpp (C++17)
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <map>
#include <optional>
#include <regex>
#include <string>
#include <utility>
#include <vector>

struct Item {
    std::string url;
    std::string audioUrl;
    std::string fileName;
    std::string sourcePage;
    std::string referrer;
    std::string formatId;
    std::string status;
    std::string createdAt;          // ISO string (used for sorting)
    std::int64_t createdAtMs = 0;   // epoch ms, 0 = unknown
    double fileSize = 0;
    double size = 0;
    double audioSize = 0;
    std::map<std::string, std::string> headers;
};

struct ErrorInfo {
    std::string message;
    std::string code;
};

namespace util {

inline double nowMs() {
    using namespace std::chrono;
    return static_cast<double>(
        duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count());
}

inline std::string lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

inline std::string trim(const std::string& s) {
    size_t a = 0, b = s.size();
    while (a < b && std::isspace(static_cast<unsigned char>(s[a]))) ++a;
    while (b > a && std::isspace(static_cast<unsigned char>(s[b - 1]))) --b;
    return s.substr(a, b - a);
}

inline bool allDigits(const std::string& s) {
    return !s.empty() && std::all_of(s.begin(), s.end(),
                                     [](unsigned char c) { return std::isdigit(c); });
}

inline bool allHex(const std::string& s) {
    return !s.empty() && std::all_of(s.begin(), s.end(),
                                     [](unsigned char c) { return std::isxdigit(c); });
}

// Returns false on malformed %XX (like decodeURIComponent throwing).
inline bool percentDecode(const std::string& in, std::string& out, bool plusAsSpace = false) {
    out.clear();
    for (size_t i = 0; i < in.size(); ++i) {
        char c = in[i];
        if (c == '%') {
            if (i + 2 >= in.size()) return false;
            if (!std::isxdigit(static_cast<unsigned char>(in[i + 1])) ||
                !std::isxdigit(static_cast<unsigned char>(in[i + 2])))
                return false;
            out.push_back(static_cast<char>(std::stoi(in.substr(i + 1, 2), nullptr, 16)));
            i += 2;
        } else if (plusAsSpace && c == '+') {
            out.push_back(' ');
        } else {
            out.push_back(c);
        }
    }
    return true;
}

struct ParsedUrl {
    std::string scheme;     // lowercase, no "://"
    std::string host;       // lowercase, with port if present
    std::string hostname;   // lowercase, without port
    std::string pathname;   // at least "/"
    std::string search;     // with leading '?', or ""
    std::string hash;       // with leading '#', or ""
    std::vector<std::pair<std::string, std::string>> params;

    std::string origin() const { return scheme + "://" + host; }
    std::string href() const { return origin() + pathname + search + hash; }

    std::optional<std::string> get(const std::string& key) const {
        for (const auto& kv : params)
            if (kv.first == key) return kv.second;
        return std::nullopt;
    }
};

// Absolute URLs only. Returns nullopt where `new URL()` would throw.
inline std::optional<ParsedUrl> parseUrl(const std::string& raw) {
    static const std::regex re(
        R"(^([a-zA-Z][a-zA-Z0-9+.\-]*)://([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$)");
    std::smatch m;
    std::string s = trim(raw);
    if (!std::regex_match(s, m, re)) return std::nullopt;

    ParsedUrl u;
    u.scheme = lower(m[1].str());
    std::string authority = m[2].str();
    auto at = authority.rfind('@');
    if (at != std::string::npos) authority = authority.substr(at + 1);
    u.host = lower(authority);
    if (u.host.empty() && u.scheme != "file") return std::nullopt;
    auto colon = u.host.rfind(':');
    u.hostname = (colon != std::string::npos && u.host.find(']') == std::string::npos)
                     ? u.host.substr(0, colon)
                     : u.host;
    u.pathname = m[3].str();
    if (u.pathname.empty()) u.pathname = "/";
    u.search = m[4].matched ? m[4].str() : "";
    if (u.search == "?") u.search.clear();
    u.hash = m[5].matched ? m[5].str() : "";
    if (u.hash == "#") u.hash.clear();

    if (!u.search.empty()) {
        std::string q = u.search.substr(1);
        size_t pos = 0;
        while (pos <= q.size()) {
            size_t amp = q.find('&', pos);
            std::string part = q.substr(pos, amp == std::string::npos ? std::string::npos : amp - pos);
            if (!part.empty()) {
                size_t eq = part.find('=');
                std::string k = part.substr(0, eq);
                std::string v = eq == std::string::npos ? "" : part.substr(eq + 1);
                std::string dk, dv;
                if (!percentDecode(k, dk, true)) dk = k;
                if (!percentDecode(v, dv, true)) dv = v;
                u.params.emplace_back(dk, dv);
            }
            if (amp == std::string::npos) break;
            pos = amp + 1;
        }
    }
    return u;
}

}  // namespace util
