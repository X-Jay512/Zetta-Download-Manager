#pragma once
// categories.js -> CategoryManager: maps a file name / host to a download category.

#include <functional>
#include <string>
#include <vector>

#include "util.h"

namespace dm {

struct Category {
  std::string key;
  std::string label;
  std::string icon;
  std::vector<std::string> extensions;           // empty => not an extension-based category
  std::function<bool(const Record&)> filter;     // empty => no filter (JS: undefined)
};

class CategoryManager {
 public:
  CategoryManager();

  // `patterns` is settings.categories.patterns: { video: ["host.com", ...], music: [...], ... }
  std::string classify(const std::string& fileName, const std::string& url,
                       const json& patterns = json()) const;

  const Category* getCategory(const std::string& name) const;  // nullptr if unknown
  std::vector<Category> getAllCategories() const { return categories_; }

 private:
  std::vector<Category> categories_;  // insertion order matters for classify()
};

}  // namespace dm
