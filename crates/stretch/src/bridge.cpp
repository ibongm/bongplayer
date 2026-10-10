// C bridge to Signalsmith Stretch for Rust. Interleaved stereo float buffers.
#include <signalsmith-stretch.h>
#include <cstddef>
#include <new>

namespace {

// Lets Signalsmith index an interleaved buffer as buffer[channel][frame].
struct Interleaved {
    float *data;
    int channels;
    struct Channel {
        float *data;
        int channel;
        int stride;
        float &operator[](int i) const { return data[i * stride + channel]; }
    };
    Channel operator[](int c) const { return Channel{data, c, channels}; }
};

}  // namespace

struct bong_stretch {
    signalsmith::stretch::SignalsmithStretch<float> engine;
    int channels;
};

extern "C" {

bong_stretch *bong_stretch_new(int channels, float sample_rate) {
    bong_stretch *s = new (std::nothrow) bong_stretch();
    if (s == nullptr) return nullptr;
    s->channels = channels;
    s->engine.presetDefault(channels, sample_rate);
    return s;
}

void bong_stretch_free(bong_stretch *s) { delete s; }

void bong_stretch_reset(bong_stretch *s) { s->engine.reset(); }

int bong_stretch_input_latency(const bong_stretch *s) { return s->engine.inputLatency(); }

int bong_stretch_output_latency(const bong_stretch *s) { return s->engine.outputLatency(); }

void bong_stretch_set_transpose(bong_stretch *s, float factor) {
    s->engine.setTransposeFactor(factor);
}

void bong_stretch_process(bong_stretch *s, float *input, int input_frames, float *output,
                          int output_frames) {
    s->engine.process(Interleaved{input, s->channels}, input_frames,
                      Interleaved{output, s->channels}, output_frames);
}

}  // extern "C"
