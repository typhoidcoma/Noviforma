use std::time::{Duration, Instant};

const FRAME_HISTORY_SIZE: usize = 120; // 2 seconds at 60fps
const STATS_LOG_INTERVAL: Duration = Duration::from_secs(1);

/// Performance statistics tracker
pub struct PerfStats {
    // Frame timing
    frame_times: Vec<Duration>,
    last_frame_time: Instant,

    // Stats reporting
    last_stats_log: Instant,

    // Current frame stats
    pub visible_tiles: usize,
    pub total_tiles: usize,
    pub upload_time_us: u64,
}

impl PerfStats {
    pub fn new() -> Self {
        Self {
            frame_times: Vec::with_capacity(FRAME_HISTORY_SIZE),
            last_frame_time: Instant::now(),
            last_stats_log: Instant::now(),
            visible_tiles: 0,
            total_tiles: 0,
            upload_time_us: 0,
        }
    }

    /// Record a frame completion
    pub fn record_frame(&mut self) {
        let now = Instant::now();
        let frame_time = now - self.last_frame_time;
        self.last_frame_time = now;

        // Add to rolling window
        if self.frame_times.len() >= FRAME_HISTORY_SIZE {
            self.frame_times.remove(0);
        }
        self.frame_times.push(frame_time);
    }

    /// Update tile counts
    pub fn update_tiles(&mut self, visible: usize, total: usize) {
        self.visible_tiles = visible;
        self.total_tiles = total;
    }

    /// Record instance upload time
    pub fn record_upload(&mut self, duration: Duration) {
        self.upload_time_us = duration.as_micros() as u64;
    }

    /// Calculate current FPS
    pub fn fps(&self) -> f32 {
        if self.frame_times.is_empty() {
            return 0.0;
        }

        let total_time: Duration = self.frame_times.iter().sum();
        let avg_frame_time = total_time.as_secs_f32() / self.frame_times.len() as f32;

        if avg_frame_time > 0.0 {
            1.0 / avg_frame_time
        } else {
            0.0
        }
    }

    /// Calculate average frame time in milliseconds
    pub fn frame_time_avg_ms(&self) -> f32 {
        if self.frame_times.is_empty() {
            return 0.0;
        }

        let total: Duration = self.frame_times.iter().sum();
        total.as_secs_f32() * 1000.0 / self.frame_times.len() as f32
    }

    /// Calculate P95 frame time in milliseconds
    pub fn frame_time_p95_ms(&self) -> f32 {
        self.percentile(0.95)
    }

    /// Calculate P99 frame time in milliseconds
    pub fn frame_time_p99_ms(&self) -> f32 {
        self.percentile(0.99)
    }

    /// Calculate percentile frame time
    fn percentile(&self, p: f32) -> f32 {
        if self.frame_times.is_empty() {
            return 0.0;
        }

        let mut sorted: Vec<f32> = self.frame_times
            .iter()
            .map(|d| d.as_secs_f32() * 1000.0)
            .collect();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let idx = ((sorted.len() as f32 * p) as usize).min(sorted.len() - 1);
        sorted[idx]
    }

    /// Check if it's time to log stats and do so if needed
    pub fn maybe_log_stats(&mut self) {
        let now = Instant::now();
        if now - self.last_stats_log >= STATS_LOG_INTERVAL {
            self.log_stats();
            self.last_stats_log = now;
        }
    }

    /// Log current performance statistics
    fn log_stats(&self) {
        let fps = self.fps();
        let avg_ms = self.frame_time_avg_ms();
        let p95_ms = self.frame_time_p95_ms();
        let p99_ms = self.frame_time_p99_ms();

        tracing::info!(
            "PERF: FPS={:.1} | Frame avg={:.2}ms p95={:.2}ms p99={:.2}ms | Tiles {}/{} | Upload={}μs",
            fps,
            avg_ms,
            p95_ms,
            p99_ms,
            self.visible_tiles,
            self.total_tiles,
            self.upload_time_us
        );
    }
}

impl Default for PerfStats {
    fn default() -> Self {
        Self::new()
    }
}
