#include "zdm_str.hpp"
#include "video_extractor.h"

#include <regex>
#include <stdexcept>

namespace dm {

namespace {

std::string scalarToString(const json& v) { return v.is_string() ? v.get<std::string>() : v.dump(); }

std::optional<std::int64_t> sizeOf(const json& f) {
  const json primary = member(f, ZDM_STR("filesize"));
  const json v = truthy(primary) ? primary : member(f, ZDM_STR("filesize_approx"));
  if (v.is_number()) return static_cast<std::int64_t>(v.get<double>());
  return std::nullopt;
}

}  // namespace

VideoExtractor::VideoExtractor(EventLoop& loop, std::string ytdlpPath)
    : loop_(loop), ytdlpPath_(std::move(ytdlpPath)) {
  if (ytdlpPath_.empty()) {
#ifdef _WIN32
    ytdlpPath_ = getBinPath(ZDM_STR("yt-dlp.exe"));
#else
    ytdlpPath_ = getBinPath(ZDM_STR("yt-dlp"));
#endif
  }
}

VideoExtractor::~VideoExtractor() {
  alive_->store(false);
  for (auto& w : workers_) w.proc->kill();
  for (auto& w : workers_) {
    if (w.thread.joinable()) w.thread.join();
  }
}

void VideoExtractor::emitLater(std::function<void()> fn) {
  auto alive = alive_;
  loop_.post([alive, fn = std::move(fn)] {
    if (alive->load()) fn();
  });
}

json VideoExtractor::getInfo(const std::string& url) const {
  const Process::Result r = Process::run(
      ytdlpPath_, {ZDM_STR("--dump-json"), ZDM_STR("--no-download"), ZDM_STR("--flat-playlist"), url});
  if (r.exitCode != 0) {
    throw std::runtime_error(r.err.empty() ? "yt-dlp exited with code " + std::to_string(r.exitCode) : r.err);
  }

  // stdout.trim().split('\n').map(JSON.parse)
  const std::string out = trim(r.out);
  std::vector<json> entries;
  std::size_t start = 0;
  for (;;) {
    const std::size_t nl = out.find('\n', start);
    entries.push_back(json::parse(out.substr(start, nl == std::string::npos ? std::string::npos : nl - start)));
    if (nl == std::string::npos) break;
    start = nl + 1;
  }
  if (entries.size() == 1) return entries.front();
  return json(entries);
}

std::future<json> VideoExtractor::getInfoAsync(const std::string& url) const {
  return std::async(std::launch::async, [this, url] { return getInfo(url); });
}

std::vector<VideoFormats> VideoExtractor::getFormats(const std::string& url) const {
  const json info = getInfo(url);
  std::vector<json> entries;
  if (info.is_array()) entries.assign(info.begin(), info.end());
  else entries.push_back(info);

  std::vector<VideoFormats> result;
  for (const auto& entry : entries) {
    VideoFormats v;
    v.title = stringOr(member(entry, ZDM_STR("title")));
    const json duration = member(entry, ZDM_STR("duration"));
    if (duration.is_number()) v.duration = duration.get<double>();
    v.thumbnail = stringOr(member(entry, ZDM_STR("thumbnail")));

    const json formats = member(entry, ZDM_STR("formats"));
    if (formats.is_array()) {
      for (const auto& f : formats) {
        FormatInfo fi;
        fi.id = scalarToString(member(f, ZDM_STR("format_id")));
        fi.ext = stringOr(member(f, ZDM_STR("ext")));
        const json resolution = member(f, ZDM_STR("resolution"));
        if (truthy(resolution)) {
          fi.resolution = scalarToString(resolution);
        } else {
          const json w = member(f, ZDM_STR("width")), h = member(f, ZDM_STR("height"));
          fi.resolution = (truthy(w) ? scalarToString(w) : "?") + "x" + (truthy(h) ? scalarToString(h) : "?");
        }
        fi.filesize = sizeOf(f);
        fi.vcodec = stringOr(member(f, ZDM_STR("vcodec")));
        fi.acodec = stringOr(member(f, ZDM_STR("acodec")));
        fi.url = stringOr(member(f, ZDM_STR("url")));
        v.formats.push_back(std::move(fi));
      }
    }
    result.push_back(std::move(v));
  }
  return result;
}

void VideoExtractor::reapFinishedWorkers() {
  for (auto it = workers_.begin(); it != workers_.end();) {
    if (it->done->load()) {
      if (it->thread.joinable()) it->thread.join();
      it = workers_.erase(it);
    } else {
      ++it;
    }
  }
}

std::shared_ptr<Process> VideoExtractor::download(const std::string& url, const std::string& outputPath,
                                                  const std::string& formatId) {
  reapFinishedWorkers();

  std::vector<std::string> args = {"-o", outputPath, ZDM_STR("--newline")};
  if (!formatId.empty()) {
    args.push_back("-f");
    args.push_back(formatId);
  }
  args.push_back(url);

  auto proc = std::make_shared<Process>(ytdlpPath_, args);
  try {
    proc->start();
  } catch (const std::exception& e) {
    const std::string message = e.what();
    emitLater([this, message] { error.emit(message); });
    return proc;
  }

  auto done = std::make_shared<std::atomic<bool>>(false);
  std::thread worker([this, proc, done, outputPath] {
    static const std::regex kPercent(ZDM_STR(R"((\d+\.?\d*)%)"));
    const int code = proc->wait(
        [this](const std::string& chunk) {  // stdout: "[download]  42.3% of ..."
          // A chunk can hold several progress lines; report the newest one. (The JS version
          // used String.match, i.e. the first one, so the displayed value could lag behind.)
          std::optional<double> percent;
          for (std::sregex_iterator it(chunk.begin(), chunk.end(), kPercent), end; it != end; ++it) {
            percent = std::stod((*it)[1].str());
          }
          if (percent) emitLater([this, p = *percent] { progress.emit(p); });
        },
        [this](const std::string& chunk) { emitLater([this, chunk] { log.emit(chunk); }); });

    if (code == 0) {
      emitLater([this, outputPath] { complete.emit(outputPath); });
    } else {
      const std::string message = "yt-dlp exited with code " + std::to_string(code);
      emitLater([this, message] { error.emit(message); });
    }
    done->store(true);
  });

  workers_.push_back({std::move(worker), proc, done});
  return proc;
}

}  // namespace dm
