#include "HlsPage.h"

// Parallel of the hidden page used by the grabber.
// The page scripts and the media recipes are not in this display tree.

HlsPage::HlsPage() : impl_(nullptr) {}
HlsPage::~HlsPage() = default;
zdmhls::HostFetch HlsPage::fetch(zdm::DownloadEngine&, const std::string&, const std::string&, const std::string&,
                                 const std::string&, const std::function<void(size_t)>&) { return {}; }
void HlsPage::cancel() {}
void HlsPage::quiet() {}
