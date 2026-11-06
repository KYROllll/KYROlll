#pragma once

#include <atomic>
#include <cstdint>
#include <type_traits>

namespace kyro
{
/**
    Single-writer / single-reader seqlock for publishing a UI frame.

    The audio thread writes; the editor thread reads. The reader never blocks the
    writer and a torn frame is retried, so no mutex ever enters processBlock().
    The DSP engine is the only writer and the editor timer is the only reader.
*/
template <typename T>
class Seqlock
{
public:
    static_assert (std::is_trivially_copyable<T>::value,
                   "Seqlock payload must be trivially copyable");

    void write (const T& value) noexcept
    {
        const auto start = sequence.load (std::memory_order_relaxed);

        sequence.store (start + 1u, std::memory_order_relaxed);
        std::atomic_thread_fence (std::memory_order_release);

        payload = value;

        std::atomic_thread_fence (std::memory_order_release);
        sequence.store (start + 2u, std::memory_order_release);
    }

    T read() const noexcept
    {
        T copy {};
        std::uint32_t start = 0;
        std::uint32_t finish = 0;

        do
        {
            start = sequence.load (std::memory_order_acquire);

            if ((start & 1u) != 0u)
                continue;

            copy = payload;
            std::atomic_thread_fence (std::memory_order_acquire);
            finish = sequence.load (std::memory_order_relaxed);
        }
        while (start != finish || (finish & 1u) != 0u);

        return copy;
    }

private:
    T payload {};
    std::atomic<std::uint32_t> sequence { 0 };
};
} // namespace kyro
