#pragma once
// extractor.js -> VideoExtractor: wraps yt-dlp.
// Long running work happens on worker threads; events are delivered on the EventLoop thread.

#include <atomic>
#include <future>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "event_loop.h"
#include "child_process.h"
#include "dm_signal.h"
#include "util.h"

namespace dm {

struct FormatInfo {
  std::string id;
  std::string ext;
  std::string resolution;
  std::optional<std::int64_t> filesize;  // filesize || filesize_approx
  std::string vcodec;
  std::string acodec;
  std::string url;
};

struct VideoFormats {
  std::string title;
  std::optional<double> duration;
  std::string thumbnail;
  std::vector<FormatInfo> formats;
};

class VideoExtractor {
 public:
  // `ytdlpPath` empty => getBinPath("yt-dlp.exe") (or "yt-dlp" on non-Windows).
  explicit VideoExtractor(EventLoop& loop, std::string ytdlpPath = {});
  ~VideoExtractor();  // kills running downloads and joins their threads
  VideoExtractor(const VideoExtractor&) = delete;
  VideoExtractor& operator=(const VideoExtractor&) = delete;

  // Blocking; throws std::runtime_error (stderr of yt-dlp) / nlohmann::json::exception.
  // Returns one JSON object for a single video, an array for a playlist.
  json getInfo(const std::string& url) const;
  std::future<json> getInfoAsync(const std::string& url) const;
  std::vector<VideoFormats> getFormats(const std::string& url) const;

  // Starts yt-dlp in the background and returns the process so the caller can kill() it.
  // Progress/log/complete/error are emitted on the loop thread.
  std::shared_ptr<Process> download(const std::string& url, const std::string& outputPath,
                                    const std::string& formatId = {});

  Signal<double> progress;                 // 'progress' (percent)
  Signal<const std::string&> log;          // 'log' (stderr chunk)
  Signal<const std::string&> complete;     // 'complete' (output path)
  Signal<const std::string&> error;        // 'error' (message)

 private:
  struct Worker {
    std::thread thread;
    std::shared_ptr<Process> proc;
    std::shared_ptr<std::atomic<bool>> done;
  };
  void reapFinishedWorkers();
  void emitLater(std::function<void()> fn);

  EventLoop& loop_;
  std::string ytdlpPath_;
  std::vector<Worker> workers_;
  std::shared_ptr<std::atomic<bool>> alive_ = std::make_shared<std::atomic<bool>>(true);
};

}  // namespace dm
