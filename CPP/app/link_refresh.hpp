#pragma once
// C++17 port of link-refresh.js
#include <cmath>
#include <limits>
#include "common.hpp"

namespace link_refresh {

using util::allDigits;
using util::allHex;

inline double toNumber(const std::string& s) {
    char* end = nullptr;
    double v = std::strtod(s.c_str(), &end);
    if (end == s.c_str() || *end != '\0') return std::numeric_limits<double>::quiet_NaN();
    return v;
}

inline double parseHex(const std::string& s) {
    return static_cast<double>(std::strtoull(s.c_str(), nullptr, 16));
}

inline bool linkLooksExpired(const std::string& url) {
    auto parsed = util::parseUrl(url);
    if (!parsed) return false;
    const double now = util::nowMs();

    for (const char* key : {"expire", "expires"}) {
        auto v = parsed->get(key);
        if (v && !v->empty() && allDigits(*v) && toNumber(*v) * 1000 < now) return true;
    }

    if (auto oe = parsed->get("oe"); oe && !oe->empty() && allHex(*oe)) {
        double expMs = parseHex(*oe) * 1000;
        if (expMs > 0 && expMs < now) return true;
    }

    if (auto e = parsed->get("exp"); e && !e->empty()) {
        double num = (allHex(*e) && !allDigits(*e)) ? parseHex(*e) : toNumber(*e);
        if (num > 0 && num * 1000 < now) return true;  // NaN compares false
    }

    auto start = parsed->get("s");
    auto life = parsed->get("e");
    if (start && life && allDigits(*start) && allDigits(*life)) {
        if ((toNumber(*start) + toNumber(*life)) * 1000 < now) return true;
    }
    return false;
}

inline std::string clipId(const std::string& url) {
    static const std::regex embed(R"(embed-([a-z0-9]{6,}))", std::regex::icase);
    static const std::regex file(R"(\/([a-z0-9]{6,})_[a-z](?:\/|,))", std::regex::icase);
    std::smatch m;
    if (std::regex_search(url, m, embed)) return util::lower(m[1].str());
    if (std::regex_search(url, m, file)) return util::lower(m[1].str());
    return "";
}

inline bool looksSigned(const std::string& url) {
    static const std::regex hostRe(
        R"(googlevideo\.com|tiktokcdn|muscdn\.com|tiktokv\.com|fbcdn\.net|cloudfront\.net)",
        std::regex::icase);
    static const std::regex keyRe(
        R"(^(expire|expires|oe|exp|signature|sig|hmac|x-amz-signature|policy|token)$)",
        std::regex::icase);
    auto parsed = util::parseUrl(url);
    if (!parsed) return false;
    if (std::regex_search(parsed->hostname, hostRe)) return true;
    for (const auto& kv : parsed->params)
        if (std::regex_match(kv.first, keyRe)) return true;
    return false;
}

// Returns the validated source page, or "" if there is none / it equals the file URL.
inline std::string sourcePageOf(const Item& opts) {
    static const std::regex httpRe(R"(^https?://)", std::regex::icase);
    const std::string& ref = !opts.sourcePage.empty() ? opts.sourcePage : opts.referrer;
    if (!std::regex_search(ref, httpRe)) return "";
    auto page = util::parseUrl(ref);
    if (!page) return "";
    if (!opts.url.empty()) {
        auto file = util::parseUrl(opts.url);
        if (!file) return "";
        if (page->href() == file->href()) return "";
    }
    return page->href();
}

// `error == nullptr` means "no error". `record` may be nullptr.
inline bool isExpiredError(const ErrorInfo* error, const Item* record) {
    static const std::regex browserRe(
        R"(browser check|browser did not continue|browser was sent a page|browser could not|web page instead of the file)",
        std::regex::icase);
    static const std::regex http410(R"(HTTP 410\b)");
    static const std::regex expiredRe(R"(expired|signature)", std::regex::icase);
    static const std::regex http401403(R"(HTTP (401|403)\b)");

    if (!error) return false;
    if (record && (linkLooksExpired(record->url) || linkLooksExpired(record->audioUrl))) return true;

    const std::string& msg = error->message;
    if (std::regex_search(msg, browserRe) && record && !sourcePageOf(*record).empty()) return true;
    if (std::regex_search(msg, http410)) return true;
    if (error->code == "LINK_EXPIRED" || std::regex_search(msg, expiredRe)) return true;

    const bool hasCreated = record && record->createdAtMs > 0;
    const double age = hasCreated ? util::nowMs() - static_cast<double>(record->createdAtMs)
                                  : std::numeric_limits<double>::infinity();
    if (age < 30 * 1000) return false;
    if (!std::regex_search(msg, http401403)) return false;
    return record && (looksSigned(record->url) || looksSigned(record->audioUrl));
}

inline std::string videoKey(const std::string& url) {
    static const std::regex re(
        R"((?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{6,}))",
        std::regex::icase);
    if (url.empty()) return "";
    std::smatch m;
    return std::regex_search(url, m, re) ? m[1].str() : "";
}

inline std::string normName(const std::string& name) {
    static const std::regex extRe(R"(\.[a-z0-9]{1,5}$)", std::regex::icase);
    static const std::regex nonAlnum(R"([^a-z0-9]+)");
    std::string s = util::lower(name);
    s = std::regex_replace(s, extRe, "");
    s = std::regex_replace(s, nonAlnum, " ");
    return util::trim(s);
}

inline std::vector<std::string> splitSpaces(const std::string& s) {
    std::vector<std::string> out;
    size_t pos = 0;
    while (true) {
        size_t sp = s.find(' ', pos);
        out.push_back(s.substr(pos, sp == std::string::npos ? std::string::npos : sp - pos));
        if (sp == std::string::npos) break;
        pos = sp + 1;
    }
    return out;
}

inline bool namesMatch(const std::string& a, const std::string& b) {
    std::string x = normName(a), y = normName(b);
    if (x.empty() || y.empty()) return false;
    if (x == y) return true;
    if (x.size() > 12 && y.size() > 12 &&
        (x.find(y) != std::string::npos || y.find(x) != std::string::npos))
        return true;

    std::vector<std::string> xt_all = splitSpaces(x), yt;
    std::vector<std::string> xt;
    for (auto& w : xt_all)
        if (w.size() > 2 && std::find(xt.begin(), xt.end(), w) == xt.end()) xt.push_back(w);  // set
    for (auto& w : splitSpaces(y))
        if (w.size() > 2) yt.push_back(w);
    if (xt.empty() || yt.empty()) return false;

    size_t shared = 0;
    for (auto& w : yt)
        if (std::find(xt.begin(), xt.end(), w) != xt.end()) ++shared;
    return shared >= 3 &&
           static_cast<double>(shared) / static_cast<double>(std::min(xt.size(), yt.size())) >= 0.6;
}

inline int scoreMatch(const Item& record, const Item& data) {
    int score = 0;
    const std::string page = !record.sourcePage.empty() ? record.sourcePage : record.referrer;
    const std::string incoming = !data.referrer.empty() ? data.referrer : data.sourcePage;

    std::string key = videoKey(page);
    if (key.empty()) key = videoKey(record.referrer);
    const std::string other = videoKey(incoming);
    if (!key.empty() && !other.empty() && key != other) return 0;

    if (namesMatch(record.fileName, data.fileName)) score += 100;

    if (!page.empty() && !incoming.empty()) {
        auto a = util::parseUrl(page);
        auto b = util::parseUrl(incoming);
        if (a && b) {
            if (a->href() == b->href()) score += 80;
            else if (a->host == b->host && a->pathname == b->pathname && a->search == b->search)
                score += 75;
        }
    }

    if (!key.empty() && !other.empty() && key == other) score += 90;

    std::string savedClip = clipId(record.url);
    if (savedClip.empty()) savedClip = clipId(page);
    if (savedClip.empty()) savedClip = clipId(record.referrer);
    std::string nextClip = clipId(data.url);
    if (nextClip.empty()) nextClip = clipId(incoming);
    if (!savedClip.empty() && !nextClip.empty() && savedClip == nextClip) score += 90;

    return score;
}

}  // namespace link_refresh
