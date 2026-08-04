#include <whisper.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

namespace {
uint16_t u16(const unsigned char *value) { return uint16_t(value[0]) | (uint16_t(value[1]) << 8); }
uint32_t u32(const unsigned char *value) { return uint32_t(value[0]) | (uint32_t(value[1]) << 8) | (uint32_t(value[2]) << 16) | (uint32_t(value[3]) << 24); }

std::vector<float> read_wav(const std::string &path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) throw std::runtime_error("cannot open WAV");
  std::vector<unsigned char> bytes((std::istreambuf_iterator<char>(input)), {});
  if (bytes.size() < 44 || std::memcmp(bytes.data(), "RIFF", 4) || std::memcmp(bytes.data() + 8, "WAVE", 4)) throw std::runtime_error("invalid WAV");
  uint16_t format = 0, channels = 0, bits = 0;
  uint32_t rate = 0;
  const unsigned char *pcm = nullptr;
  size_t pcm_size = 0;
  for (size_t offset = 12; offset + 8 <= bytes.size();) {
    const uint32_t size = u32(bytes.data() + offset + 4);
    const size_t start = offset + 8;
    if (start + size > bytes.size()) throw std::runtime_error("truncated WAV");
    if (!std::memcmp(bytes.data() + offset, "fmt ", 4) && size >= 16) {
      format = u16(bytes.data() + start);
      channels = u16(bytes.data() + start + 2);
      rate = u32(bytes.data() + start + 4);
      bits = u16(bytes.data() + start + 14);
    } else if (!std::memcmp(bytes.data() + offset, "data", 4)) {
      pcm = bytes.data() + start;
      pcm_size = size;
    }
    offset = start + size + (size & 1);
  }
  if (format != 1 || channels != 1 || bits != 16 || rate < 8000 || rate > 192000 || !pcm || pcm_size < 2 || pcm_size % 2) throw std::runtime_error("unsupported WAV format");
  const size_t source_count = pcm_size / 2;
  std::vector<float> source(source_count);
  for (size_t index = 0; index < source_count; ++index) source[index] = int16_t(u16(pcm + index * 2)) / 32768.0f;
  if (rate == 16000) return source;
  const size_t target_count = std::max<size_t>(1, source_count * 16000ULL / rate);
  std::vector<float> target(target_count);
  for (size_t index = 0; index < target_count; ++index) {
    const double position = double(index) * rate / 16000.0;
    const size_t left = std::min(source_count - 1, size_t(position));
    const size_t right = std::min(source_count - 1, left + 1);
    const float fraction = float(position - left);
    target[index] = source[left] + (source[right] - source[left]) * fraction;
  }
  return target;
}
}

int main(int argc, char **argv) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    std::cout << "Waypoint whisper.cpp local speech runtime\n";
    return 0;
  }
  std::string model, audio, output;
  for (int index = 1; index < argc; ++index) {
    const std::string arg = argv[index];
    if ((arg == "-m" || arg == "-f" || arg == "-of") && index + 1 < argc) {
      const std::string value = argv[++index];
      if (arg == "-m") model = value;
      else if (arg == "-f") audio = value;
      else output = value;
    }
  }
  if (model.empty() || audio.empty() || output.empty()) {
    std::cerr << "required local speech arguments are missing\n";
    return 2;
  }
  try {
    const auto samples = read_wav(audio);
    auto context_params = whisper_context_default_params();
    context_params.use_gpu = true;
    whisper_context *context = whisper_init_from_file_with_params(model.c_str(), context_params);
    if (!context) throw std::runtime_error("model load failed");
    auto params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.n_threads = std::max(1u, std::min(8u, std::thread::hardware_concurrency()));
    params.language = "en";
    params.translate = false;
    params.no_context = true;
    params.no_timestamps = true;
    params.print_progress = false;
    params.print_realtime = false;
    params.print_timestamps = false;
    const int status = whisper_full(context, params, samples.data(), int(samples.size()));
    if (status != 0) {
      whisper_free(context);
      throw std::runtime_error("transcription failed");
    }
    std::ofstream transcript(output + ".txt", std::ios::binary | std::ios::trunc);
    if (!transcript) {
      whisper_free(context);
      throw std::runtime_error("cannot create transcript");
    }
    const int segments = whisper_full_n_segments(context);
    for (int index = 0; index < segments; ++index) transcript << whisper_full_get_segment_text(context, index);
    transcript.close();
    whisper_free(context);
    return transcript ? 0 : 3;
  } catch (const std::exception &error) {
    std::cerr << "local speech failed: " << error.what() << "\n";
    return 1;
  }
}
