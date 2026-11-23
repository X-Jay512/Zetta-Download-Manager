#include "zdm_str.hpp"
#include "video_muxer.h"

#include <algorithm>
#include <regex>
#include <stdexcept>

#include "child_process.h"

namespace dm {

namespace {

// "HH:MM:SS" captured by `re` -> seconds
std::optional<long> secondsFrom(const std::string& text, const std::regex& re) {
  std::smatch m;
  if (!std::regex_search(text, m, re)) return std::nullopt;
  return std::stol(m[1].str()) * 3600 + std::stol(m[2].str()) * 60 + std::stol(m[3].str());
}

}  // namespace

VideoMuxer::VideoMuxer(EventLoop& loop, std::string ffmpegPath)
    : loop_(loop), ffmpegPath_(std::move(ffmpegPath)) {
  if (!ffmpegPath_.empty()) return;
  ffmpegPath_ = ZDM_STR("ffmpeg");
#ifdef _WIN32
  std::error_code ec;
  const fs::path vendor = exeDir() / ZDM_STR("vendor") / ZDM_STR("ffmpeg.exe");
  const fs::path bundled = exeDir() / ZDM_STR("bin") / ZDM_STR("ffmpeg.exe");
  if (fs::exists(vendor, ec)) ffmpegPath_ = pathToUtf8(vendor);
  else if (fs::exists(bundled, ec)) ffmpegPath_ = pathToUtf8(bundled);
#endif
}

void VideoMuxer::emitLater(std::function<void()> fn) {
  auto alive = alive_;
  loop_.post([alive, fn = std::move(fn)] {
    if (alive->load()) fn();
  });
}

std::future<std::string> VideoMuxer::mux(const std::string& videoPath, const std::string& audioPath,
                                         const std::string& outputPath) {
  return std::async(std::launch::async,
                    [this, videoPath, audioPath, outputPath] { return muxBlocking(videoPath, audioPath, outputPath); });
}

std::string VideoMuxer::muxBlocking(const std::string& videoPath, const std::string& audioPath,
                                    const std::string& outputPath) {
  Process proc(ffmpegPath_, {"-i", videoPath, "-i", audioPath, "-c", ZDM_STR("copy"),
                             ZDM_STR("-movflags"), ZDM_STR("+faststart"), "-y", outputPath});
  try {
    proc.start();
  } catch (const std::exception& e) {
    const std::string message = e.what();
    emitLater([this, message] { error.emit(message); });
    throw;
  }

  static const std::regex kDuration(ZDM_STR(R"(Duration:\s*(\d+):(\d+):(\d+))"));
  static const std::regex kTime(ZDM_STR(R"(time=(\d+):(\d+):(\d+))"));

  std::string seen;                 // recent stderr (also used for the error message)
  std::optional<long> total;        // seconds; the first "Duration:" is the video input's

  const int code = proc.wait(
      nullptr,  // ffmpeg writes nothing useful to stdout
      [&](const std::string& chunk) {
        seen += chunk;
        if (!total) total = secondsFrom(seen, kDuration);
        if (seen.size() > 65536) seen.erase(0, seen.size() - 65536);  // bounded, unlike the JS string

        const auto current = secondsFrom(chunk, kTime);
        if (total && *total > 0 && current) {
          const double percent = std::min(100.0, static_cast<double>(*current) / static_cast<double>(*total) * 100.0);
          emitLater([this, percent] { progress.emit(percent); });
        }
      });

  if (code == 0) {
    emitLater([this, outputPath] { complete.emit(outputPath); });
    return outputPath;
  }
  const std::string tail = seen.size() > 200 ? seen.substr(seen.size() - 200) : seen;
  const std::string message = "ffmpeg exited with code " + std::to_string(code) + ": " + tail;
  emitLater([this, message] { error.emit(message); });
  throw std::runtime_error(message);
}

json VideoMuxer::probe(const std::string& filePath) const {
  // ffmpeg -> ffprobe. Replace the *last* "ffmpeg" (the file name), not one in a parent folder.
  std::string ffprobePath = ffmpegPath_;
  const std::size_t pos = ffprobePath.rfind(ZDM_STR("ffmpeg"));
  if (pos != std::string::npos) ffprobePath.replace(pos, 6, ZDM_STR("ffprobe"));

  const Process::Result r = Process::run(
      ffprobePath, {"-v", ZDM_STR("quiet"), "-print_format", ZDM_STR("json"), "-show_format", "-show_streams", filePath});
  if (r.exitCode != 0) throw std::runtime_error(ZDM_STR("ffprobe failed"));
  return json::parse(r.out);
}

}  // namespace dm
