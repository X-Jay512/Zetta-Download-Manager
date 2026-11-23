#pragma once
// C++17 port of duplicates.js
#include <cmath>
#include "common.hpp"

namespace duplicates {

inline double sanitizeSize(double n) {
    return (std::isfinite(n) && n > 0) ? std::round(n) : 0;
}

inline double fileSizeOf(const Item& item) {
    return sanitizeSize(item.fileSize != 0 ? item.fileSize : item.size);
}

inline double audioSizeOf(const Item& item) { return sanitizeSize(item.audioSize); }

inline double totalSizeOf(const Item& item) { return fileSizeOf(item) + audioSizeOf(item); }

inline bool sameSize(const Item& a, const Item& b) {
    double x = totalSizeOf(a), y = totalSizeOf(b);
    return x > 0 && x == y;
}

inline std::string sourcePageOf(const Item& item) {
    if (!item.sourcePage.empty()) return item.sourcePage;
    if (!item.referrer.empty()) return item.referrer;
    auto it = item.headers.find("Referer");
    if (it != item.headers.end() && !it->second.empty()) return it->second;
    it = item.headers.find("referer");
    if (it != item.headers.end()) return it->second;
    return "";
}

inline std::string stripTrailingSlash(std::string s) {
    if (!s.empty() && s.back() == '/') s.pop_back();
    return s;
}

inline std::string sourceKey(const std::string& page) {
    static const std::regex yt(
        R"((?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/))([\w-]{6,}))",
        std::regex::icase);
    const std::string raw = util::trim(page);
    if (raw.empty()) return "";
    std::smatch m;
    if (std::regex_search(raw, m, yt)) return "youtube:" + util::lower(m[1].str());
    if (auto parsed = util::parseUrl(raw))
        return util::lower(stripTrailingSlash(parsed->origin() + parsed->pathname));
    std::string s = raw.substr(0, raw.find('?'));
    s = s.substr(0, s.find('#'));
    return util::lower(stripTrailingSlash(s));
}

inline std::string nameExtKey(const std::string& name) {
    static const std::regex genericStem(
        R"(^(download|video|file|index|watch|videoplayback|playlist|manifest)$)");
    static const std::regex suffix(R"((?:_\d+|\s*\(\d+\))$)");
    static const std::regex seps(R"([_+]+)");
    static const std::regex spaces(R"(\s+)");

    std::string raw = name;
    if (size_t p = raw.find_last_of("\\/"); p != std::string::npos) raw = raw.substr(p + 1);
    raw = raw.substr(0, raw.find('?'));
    raw = raw.substr(0, raw.find('#'));
    raw = util::trim(raw);
    if (raw.empty()) return "";

    std::string clean;
    if (!util::percentDecode(raw, clean)) clean = raw;  // keep the raw name
    clean = util::lower(clean);

    size_t dot = clean.rfind('.');
    std::string ext = (dot != std::string::npos && dot > 0) ? clean.substr(dot) : "";
    if (ext.empty()) return "";

    std::string stem = std::regex_replace(clean.substr(0, dot), suffix, "");
    stem = std::regex_replace(stem, seps, " ");
    stem = std::regex_replace(stem, spaces, " ");
    stem = util::trim(stem);
    if (stem.empty() || std::regex_match(stem, genericStem)) return "";
    return stem + ext;
}

inline bool sameSource(const Item& row, const Item& opts) {
    std::string left = sourceKey(sourcePageOf(row));
    std::string right = sourceKey(sourcePageOf(opts));
    return !left.empty() && left == right;
}

inline bool sameNameExt(const Item& row, const Item& opts) {
    std::string left = nameExtKey(row.fileName);
    std::string right = nameExtKey(opts.fileName);
    return !left.empty() && left == right;
}

inline std::string qualityTag(const Item& item) {
    static const std::regex fromNameRe(R"((?:^|[\s_-])(\d{3,4})p(?:[\s_.-]|$))", std::regex::icase);
    static const std::regex boxRe(R"((\d{2,5})x(\d{2,5}))");
    std::smatch m;
    if (std::regex_search(item.fileName, m, fromNameRe)) return m[1].str();
    const std::string& url = !item.url.empty() ? item.url : item.audioUrl;
    if (std::regex_search(url, m, boxRe)) return m[2].str();
    return "";
}

inline bool isDuplicateRow(const Item& row, const Item& opts) {
    if (!opts.url.empty() && !row.url.empty() && opts.url == row.url) return true;

    if (sameSource(row, opts)) {
        if (!opts.formatId.empty() && !row.formatId.empty() && opts.formatId != row.formatId)
            return false;
        std::string leftTag = qualityTag(row), rightTag = qualityTag(opts);
        if (!leftTag.empty() && !rightTag.empty() && leftTag != rightTag) return false;
        double left = totalSizeOf(row), right = totalSizeOf(opts);
        if (left > 0 && right > 0 &&
            std::fabs(left - right) > std::max(256.0 * 1024.0, left * 0.08))
            return false;
        std::string leftName = nameExtKey(row.fileName), rightName = nameExtKey(opts.fileName);
        if (!leftName.empty() && !rightName.empty() && leftName != rightName) return false;
        return true;
    }

    double left = totalSizeOf(row), right = totalSizeOf(opts);
    if (left > 0 && right > 0 && left != right) return false;
    if (sameSize(row, opts) && sameNameExt(row, opts)) return true;
    return false;
}

// Returns a pointer into `rows`, or nullptr if there is no duplicate.
inline const Item* findDuplicate(const std::vector<Item>& rows, const Item& opts) {
    std::vector<const Item*> pool;
    for (const auto& r : rows)
        if (isDuplicateRow(r, opts)) pool.push_back(&r);
    if (pool.empty()) return nullptr;

    std::vector<const Item*> unfinished;
    for (auto* r : pool)
        if (r->status != "complete") unfinished.push_back(r);

    std::vector<const Item*>& ranked = unfinished.empty() ? pool : unfinished;
    std::stable_sort(ranked.begin(), ranked.end(), [](const Item* a, const Item* b) {
        return a->createdAt > b->createdAt;  // newest first
    });
    return ranked.front();
}

}  // namespace duplicates
