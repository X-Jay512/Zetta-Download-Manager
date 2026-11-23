// crx_pack.h — C++17 port of crx-pack.js
// Builds zdm.crx / zdm.xpi / update.xml from an unpacked extension folder.
// Needs OpenSSL (libcrypto) and nlohmann/json.
#pragma once

#include <string>

#include "util.h"
#include "zdm_str.hpp"

namespace zdm {

inline const char* kUpdateName() { return ZDM_STR("update.xml"); }
inline const char* kCrxName() { return ZDM_STR("zdm.crx"); }
inline const char* kXpiName() { return ZDM_STR("zdm.xpi"); }
inline const char* kFirefoxId() { return ZDM_STR("zetta-download-manager@xjay5.com"); }
inline const char* kHost() { return ZDM_STR("http://127.0.0.1"); }

struct ExtDist {
  fs::path dir;
  std::string id;
  std::string version;
  std::string firefoxId;
  std::string host;
};

struct ExtIdentity {
  std::string id;
  std::string version;
};

// Writes zdm.crx, zdm.xpi, update.xml and id.txt into <userData>/extension-dist.
// Creates <userData>/extension-key.pem on first use. Throws std::exception on failure.
ExtDist prepareExtensionDist(const fs::path& extDir, const fs::path& userData);

ExtIdentity extensionIdentity(const fs::path& extDir, const fs::path& userData);

// Chrome extension id: first 16 bytes of SHA-256(spki), each nibble mapped to 'a'..'p'.
std::string extensionId(const Bytes& spki);

// Same mapping applied to arbitrary bytes (used for the id of an unpacked extension folder).
std::string extensionIdFromBytes(const Bytes& data);

// Public key (SPKI DER) of a PEM private key file.
Bytes spkiFromPrivateKeyFile(const fs::path& pemPath);

std::string base64Encode(const Bytes& data);

}  // namespace zdm
