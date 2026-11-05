// Private stdin/stdout bridge to Ableton Link for the standalone prototype.
// Only this process owns Link. WebAudio receives timestamped snapshots through
// the desktop host; it never treats IPC delivery as a musical clock.
#include <ableton/Link.hpp>

#include <algorithm>
#include <atomic>
#include <charconv>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <locale>
#include <sstream>
#include <string>
#include <vector>

namespace
{
constexpr double quantum = 4.0;
// Leave time for desktop IPC and WebAudio to schedule the first audible beat.
constexpr auto startLead = std::chrono::microseconds{150000};
constexpr std::uint64_t maxId = 9007199254740991ULL;

bool parseId(const std::string& text, std::uint64_t& id)
{
  const auto result = std::from_chars(text.data(), text.data() + text.size(), id);
  return result.ec == std::errc{} && result.ptr == text.data() + text.size()
         && id > 0 && id <= maxId;
}

bool parseTempo(const std::string& text, double& tempo)
{
  char* end = nullptr;
  tempo = std::strtod(text.c_str(), &end);
  return end == text.c_str() + text.size() && end != text.c_str()
         && std::isfinite(tempo) && tempo >= 20.0 && tempo <= 999.0;
}

void error(const std::uint64_t id, const char* message)
{
  std::cout << "{\"id\":" << id << ",\"ok\":false,\"error\":\"" << message
            << "\"}" << std::endl;
}

class Bridge
{
public:
  Bridge()
  {
    mLink.setStartStopCallback([this](const bool playing)
    {
      if (!playing)
        mObservedStop.store(true);
    });
  }

  void command(const std::uint64_t id, const std::vector<std::string>& words)
  {
    const auto& verb = words[1];
    const auto isStatus = verb == "status";
    const auto isBoolean = verb == "enable" || verb == "sync" || verb == "play";
    double tempo = 0;
    if ((!isStatus && !isBoolean && verb != "tempo")
        || words.size() != (isStatus ? 2u : 3u))
    {
      error(id, "Expected status, enable 0|1, sync 0|1, tempo 20..999, or play 0|1.");
      return;
    }
    if (isBoolean && words[2] != "0" && words[2] != "1")
    {
      error(id, "Boolean commands accept only 0 or 1.");
      return;
    }
    if (verb == "tempo" && !parseTempo(words[2], tempo))
    {
      error(id, "Tempo must be a finite number from 20 to 999 BPM.");
      return;
    }

    if (verb == "enable")
    {
      const auto enabled = words[2] == "1";
      // Leave the session before stopping locally: disconnecting must never
      // issue a Stop command to another musician's transport.
      mLink.enable(enabled);
      if (!enabled)
      {
        auto state = mLink.captureAppSessionState();
        state.setIsPlaying(false, mLink.clock().micros());
        mLink.commitAppSessionState(state);
      }
    }
    else if (verb == "sync")
    {
      mLink.enableStartStopSync(words[2] == "1");
    }
    else if (verb == "tempo" || verb == "play")
    {
      auto state = mLink.captureAppSessionState();
      const auto now = mLink.clock().micros();
      if (verb == "tempo")
        state.setTempo(tempo, now);
      else
        state.setIsPlaying(words[2] == "1", words[2] == "1" ? now + startLead : now);
      mLink.commitAppSessionState(state);
    }

    // Link keeps receiving transport changes while stdin is idle. Consume the
    // stop latch before capturing, so a later stop cannot be lost behind an
    // earlier playing snapshot. A delayed callback for an accepted restart must
    // not rebase that same start event twice.
    const auto observedStop = mObservedStop.exchange(false);
    auto state = mLink.captureAppSessionState();
    const auto restarted = observedStop && state.timeForIsPlaying() != mTransportTime;
    if (state.isPlaying() && (!mPlaying || restarted))
    {
      // Only a local stopped-to-playing transition starts a new sequence. A
      // peer pressing Play while we run must not reset our beat magnitude.
      const auto earliest = verb == "play" ? state.timeForIsPlaying()
                                            : mLink.clock().micros() + startLead;
      state.requestBeatAtTime(0.0, std::max(earliest, state.timeForIsPlaying()), quantum);
      mLink.commitAppSessionState(state);
      // Stable identity of this local run, unaffected by tempo edits or another
      // peer's Play command. Unlike timeAtBeat(0), it is not a predicted time.
      mTransportTime = state.timeForIsPlaying();
    }
    mPlaying = state.isPlaying();
    const auto now = mLink.clock().micros();
    const auto start = state.isPlaying() ? state.timeAtBeat(0.0, quantum)
                                        : state.timeForIsPlaying();
    std::cout << std::boolalpha << std::setprecision(17)
              << "{\"id\":" << id << ",\"ok\":true,\"state\":{\"enabled\":"
              << mLink.isEnabled() << ",\"peers\":" << mLink.numPeers()
              << ",\"tempo\":" << state.tempo()
              << ",\"beat\":" << state.beatAtTime(now, quantum)
              << ",\"phase\":" << state.phaseAtTime(now, quantum)
              << ",\"playing\":" << state.isPlaying()
              << ",\"startStopSync\":" << mLink.isStartStopSyncEnabled()
              << ",\"timeUs\":" << now.count()
              << ",\"startTimeUs\":" << start.count()
              << ",\"transportTimeUs\":" << mTransportTime.count() << "}}" << std::endl;
  }

private:
  // Link's thread callback can access this until Link's destructor has finished.
  std::atomic<bool> mObservedStop{false};
  ableton::Link mLink{120.0};
  bool mPlaying = false;
  std::chrono::microseconds mTransportTime{0};
};
} // namespace

int main()
{
  std::locale::global(std::locale::classic());
  try
  {
    Bridge bridge;
    std::string line;
    while (std::getline(std::cin, line))
    {
      std::istringstream input(line);
      std::vector<std::string> words;
      std::string word;
      while (input >> word && words.size() < 4)
        words.push_back(word);
      std::uint64_t id = 0;
      if (words.empty() || !parseId(words.front(), id))
      {
        error(0, "Expected a positive safe-integer request ID.");
        continue;
      }
      if (line.size() > 256 || words.size() < 2 || words.size() > 3)
      {
        error(id, "Invalid command length or argument count.");
        continue;
      }
      bridge.command(id, words);
    }
  }
  catch (const std::exception& exception)
  {
    std::cerr << "Link helper failed: " << exception.what() << '\n';
    return 1;
  }
  return 0;
}
