#pragma once

#include "hls_handler.h"

#include <functional>
#include <string>

namespace zdm {
class DownloadEngine;
}

// Hidden Edge page. Sites that refuse a plain request are read from here,
// the same way the Electron build reads them from its hidden window.
class HlsPage {
public:
    HlsPage();
    ~HlsPage();

    zdmhls::HostFetch fetch(zdm::DownloadEngine& engine, const std::string& taskId, const std::string& url,
                            const std::string& kind, const std::string& dest,
                            const std::function<void(size_t)>& onChunk);
    void cancel();
    // Native downloads do not need the hidden player. Pause it and leave the page blank.
    void quiet();

private:
    struct Impl;
    Impl* impl_;
};
