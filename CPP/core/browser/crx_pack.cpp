#include "crx_pack.h"

// Parallel of JS/core/crx-pack.js.
// Packing and the local update host are not in this display tree.

namespace zdm {
ExtDist prepareExtensionDist(const fs::path&, const fs::path&) { return {}; }
ExtIdentity extensionIdentity(const fs::path&, const fs::path&) { return {}; }
std::string extensionId(const Bytes&) { return {}; }
std::string extensionIdFromBytes(const Bytes&) { return {}; }
Bytes spkiFromPrivateKeyFile(const fs::path&) { return {}; }
std::string base64Encode(const Bytes&) { return {}; }
}
