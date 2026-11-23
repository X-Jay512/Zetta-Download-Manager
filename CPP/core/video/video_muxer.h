#pragma once
// muxer.js -> VideoMuxer: merges a video and an audio file with ffmpeg (stream copy).

#include <atomic>
#include <future>
#include <memory>
#include <string>

#include "event_loop.h"
#include "dm_signal.h"
#include "util.h"

namespace dm {

class VideoMuxer {
 public:
  // `ffmpegPath` empty => <exeDir>/vendor/ffmpeg.exe if it exists, otherwise "ffmpeg" from PATH.
  explicit VideoMuxer(EventLoop& loop, std::string ffmpegPath = {});
  ~VideoMuxer() { alive_->store(false); }

  // Promise-style: runs on a worker thread. The returned future throws std::runtime_error on failure.
  // Keep the future: a discarded std::async future blocks until the job is done.
  [[nodiscard]] std::future<std::string> mux(const std::string& videoPath, const std::string& audioPath,
                                             const std::string& outputPath);
  std::string muxBlocking(const std::string& videoPath, const std::string& audioPath,
                          const std::string& outputPath);

  json probe(const std::string& filePath) const;  // ffprobe -show_format -show_streams (blocking)

  Signal<double> progress;                // 'progress' (0..100)
  Signal<const std::string&> complete;    // 'complete' (output path)
  Signal<const std::string&> error;       // 'error' (message)

 private:
  void emitLater(std::function<void()> fn);

  EventLoop& loop_;
  std::string ffmpegPath_;
  std::shared_ptr<std::atomic<bool>> alive_ = std::make_shared<std::atomic<bool>>(true);
};

}  // namespace dm
