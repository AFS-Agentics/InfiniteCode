const HEAD_LIMIT: usize = 512 * 1024;
const TAIL_LIMIT: usize = 512 * 1024;

pub struct HeadTailBuffer {
    head: Vec<u8>,
    tail: Vec<u8>,
    tail_start: usize,
    tail_len: usize,
    total: usize,
    dropped: bool,
    head_limit: usize,
    tail_limit: usize,
}

impl HeadTailBuffer {
    pub fn new() -> Self {
        HeadTailBuffer {
            head: Vec::new(),
            tail: Vec::new(),
            tail_start: 0,
            tail_len: 0,
            total: 0,
            dropped: false,
            head_limit: HEAD_LIMIT,
            tail_limit: TAIL_LIMIT,
        }
    }

    pub fn push(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        self.total += bytes.len();

        if self.head.len() < self.head_limit {
            let space = self.head_limit - self.head.len();
            let take = bytes.len().min(space);
            self.head.extend_from_slice(&bytes[..take]);

            if take < bytes.len() {
                self.dropped = true;
                self.push_tail(&bytes[take..]);
            }
        } else {
            self.dropped = true;
            self.push_tail(bytes);
        }
    }

    pub fn collect(&self) -> String {
        let mut result = String::with_capacity(self.head.len() + self.tail.len() + 100);

        // SAFETY: head bytes are from PTY output, lossy conversion is acceptable
        let head_str = String::from_utf8_lossy(&self.head);
        result.push_str(&head_str);

        self.push_tail_lossy_to_string(&mut result);

        result
    }

    /// Collect raw bytes (for when callers need `Vec<u8>` directly)
    pub fn collect_bytes(&self) -> Vec<u8> {
        let mut result = Vec::with_capacity(self.head.len() + self.tail_len);
        result.extend_from_slice(&self.head);
        self.extend_with_tail(&mut result);
        result
    }

    pub fn drain_collect_bytes(&mut self) -> Vec<u8> {
        let result = self.collect_bytes();
        self.head.clear();
        self.tail.clear();
        self.tail_start = 0;
        self.tail_len = 0;
        self.total = 0;
        self.dropped = false;
        result
    }

    pub fn total(&self) -> usize {
        self.total
    }

    pub fn truncated(&self) -> bool {
        self.dropped
    }

    fn push_tail(&mut self, bytes: &[u8]) {
        if bytes.is_empty() || self.tail_limit == 0 {
            return;
        }

        if bytes.len() >= self.tail_limit {
            self.tail.clear();
            self.tail
                .extend_from_slice(&bytes[bytes.len() - self.tail_limit..]);
            self.tail_start = 0;
            self.tail_len = self.tail_limit;
            return;
        }

        if self.tail.len() < self.tail_limit {
            let available = self.tail_limit - self.tail.len();
            let take = bytes.len().min(available);
            self.tail.extend_from_slice(&bytes[..take]);
            self.tail_len += take;
            if take == bytes.len() {
                return;
            }
            self.push_tail(&bytes[take..]);
            return;
        }

        let first = bytes.len().min(self.tail_limit - self.tail_start);
        self.tail[self.tail_start..self.tail_start + first].copy_from_slice(&bytes[..first]);
        if first < bytes.len() {
            self.tail[..bytes.len() - first].copy_from_slice(&bytes[first..]);
        }
        self.tail_start = (self.tail_start + bytes.len()) % self.tail_limit;
        self.tail_len = self.tail_limit;
    }

    fn extend_with_tail(&self, out: &mut Vec<u8>) {
        if self.tail_len == 0 {
            return;
        }
        if self.tail_len < self.tail_limit || self.tail_start == 0 {
            out.extend_from_slice(&self.tail[..self.tail_len]);
            return;
        }
        out.extend_from_slice(&self.tail[self.tail_start..]);
        out.extend_from_slice(&self.tail[..self.tail_start]);
    }

    fn push_tail_lossy_to_string(&self, out: &mut String) {
        if self.tail_len == 0 {
            return;
        }
        if self.tail_len < self.tail_limit || self.tail_start == 0 {
            out.push_str(&String::from_utf8_lossy(&self.tail[..self.tail_len]));
            return;
        }
        out.push_str(&String::from_utf8_lossy(&self.tail[self.tail_start..]));
        out.push_str(&String::from_utf8_lossy(&self.tail[..self.tail_start]));
    }
}

impl Default for HeadTailBuffer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use std::hint::black_box;
    use std::time::Instant;

    #[test]
    fn buffer_keeps_small_content() {
        let mut buf = HeadTailBuffer::new();
        buf.push(b"hello world");
        let result = buf.collect();
        assert_eq!(result, "hello world");
        assert!(!buf.truncated());
    }

    #[test]
    fn buffer_keeps_head_and_tail_when_overflow() {
        let mut buf = HeadTailBuffer::new();
        buf.head_limit = 10;
        buf.tail_limit = 10;

        let data = b"0123456789ABCDEFGHIJ";
        buf.push(data);
        let result = buf.collect();
        assert!(result.starts_with("0123456789"));
        assert!(result.contains("GHIJ"));
        assert!(buf.truncated());
        assert_eq!(buf.total(), 20);
    }

    #[test]
    fn buffer_preserves_tail_across_multiple_pushes() {
        let mut buf = HeadTailBuffer::new();
        buf.head_limit = 5;
        buf.tail_limit = 5;

        buf.push(b"AAAAA");
        buf.push(b"BBBBB");
        buf.push(b"CCCCC");
        let result = buf.collect();
        assert!(result.starts_with("AAAAA"));
        assert!(result.contains("CCCCC"));
        assert!(buf.truncated());
    }

    #[test]
    fn empty_buffer_returns_empty() {
        let buf = HeadTailBuffer::new();
        assert!(buf.collect().is_empty());
    }

    #[test]
    fn buffer_utf8_multibyte_boundary() {
        let mut buf = HeadTailBuffer::new();
        buf.head_limit = 3;
        buf.tail_limit = 3;

        // 3-byte UTF-8 character "€" = [0xE2, 0x82, 0xAC]
        // Push data so that head limit is hit in the middle of the character
        buf.push(b"ab"); // 2 bytes
        buf.push(&[0xE2, 0x82, 0xAC]); // head overflows within the 3-byte char

        let result = buf.collect();
        // collect() uses from_utf8_lossy which handles broken UTF-8 gracefully
        // The important thing is it doesn't panic
        assert!(result.contains('\u{FFFD}') || result.contains("ab"));
    }

    #[test]
    fn buffer_multiple_pushes_no_drop() {
        let mut buf = HeadTailBuffer::new();
        for i in 0..10 {
            buf.push(format!("line {i}\n").as_bytes());
        }
        assert!(!buf.truncated());
        let result = buf.collect();
        assert!(result.contains("line 0"));
        assert!(result.contains("line 9"));
    }

    #[test]
    fn buffer_zero_byte_push() {
        let mut buf = HeadTailBuffer::new();
        buf.push(b"");
        assert!(buf.collect().is_empty());
    }

    #[test]
    fn buffer_total_tracks_bytes() {
        let mut buf = HeadTailBuffer::new();
        buf.push(b"abc");
        buf.push(b"def");
        assert_eq!(buf.total(), 6);
    }

    #[test]
    fn buffer_collect_bytes_matches() {
        let mut buf = HeadTailBuffer::new();
        buf.push(b"hello");
        assert_eq!(&buf.collect_bytes(), b"hello");
    }

    #[test]
    fn buffer_drain_collect_bytes_clears_buffer() {
        let mut buf = HeadTailBuffer::new();
        buf.push(b"hello");

        assert_eq!(&buf.drain_collect_bytes(), b"hello");
        assert_eq!(&buf.collect_bytes(), b"");
        assert_eq!(buf.total(), 0);
        assert!(!buf.truncated());
    }

    #[test]
    fn buffer_truncation_preserves_tail() {
        let mut buf = HeadTailBuffer::new();
        buf.head_limit = 20;
        buf.tail_limit = 20;

        let data = "A".repeat(100);
        buf.push(data.as_bytes());
        assert!(buf.truncated());

        let result = buf.collect();
        // Should have head and tail without inserting a second truncation marker.
        assert!(result.starts_with("AAAAAAAAAA"));
        assert_eq!(result.len(), 40);
    }

    #[test]
    fn buffer_circular_tail_preserves_exact_order_after_wrap() {
        let mut buf = HeadTailBuffer::new();
        buf.head_limit = 0;
        buf.tail_limit = 8;

        buf.push(b"abcdefgh");
        buf.push(b"ijkl");

        assert!(buf.truncated());
        assert_eq!(buf.collect_bytes(), b"efghijkl");
        assert_eq!(buf.collect(), "efghijkl");
    }

    #[test]
    fn buffer_single_push_exactly_fits_head() {
        let mut buf = HeadTailBuffer::new();
        buf.head_limit = 10;

        let data = b"1234567890";
        buf.push(data);
        assert!(!buf.truncated());
        assert_eq!(buf.collect(), "1234567890");
    }

    #[test]
    fn buffer_collect_empty_on_new() {
        let buf = HeadTailBuffer::new();
        assert_eq!(buf.collect(), "");
        assert_eq!(buf.collect_bytes(), b"");
        assert_eq!(buf.total(), 0);
        assert!(!buf.truncated());
    }

    #[test]
    #[ignore]
    fn bench_push_large_chunks_replaces_tail() {
        let chunk = vec![b'x'; 128 * 1024];
        let iterations = 5_000;
        let started = Instant::now();
        let mut total = 0usize;

        for _ in 0..iterations {
            let mut buf = HeadTailBuffer::new();
            buf.head_limit = 0;
            buf.tail_limit = 64 * 1024;
            for _ in 0..16 {
                buf.push(black_box(&chunk));
            }
            total += black_box(buf.collect_bytes()).len();
        }

        let elapsed = started.elapsed();
        assert_eq!(total, iterations * 64 * 1024);
        println!(
            "head_tail_buffer_push_large_chunks iterations={iterations} chunks_per_iter=16 elapsed_ms={} per_iter_us={:.2}",
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64
        );
    }

    #[test]
    #[ignore]
    fn bench_push_small_chunks_after_tail_saturation() {
        let chunk = vec![b'x'; 256];
        let iterations = 2_000;
        let started = Instant::now();
        let mut total = 0usize;

        for _ in 0..iterations {
            let mut buf = HeadTailBuffer::new();
            buf.head_limit = 0;
            buf.tail_limit = 64 * 1024;
            buf.push(&vec![b'a'; 64 * 1024]);
            for _ in 0..512 {
                buf.push(black_box(&chunk));
            }
            total += black_box(buf.collect_bytes()).len();
        }

        let elapsed = started.elapsed();
        assert_eq!(total, iterations * 64 * 1024);
        println!(
            "head_tail_buffer_push_small_chunks_after_tail_saturation iterations={iterations} chunks_per_iter=512 elapsed_ms={} per_iter_us={:.2}",
            elapsed.as_secs_f64() * 1_000.0,
            elapsed.as_secs_f64() * 1_000_000.0 / iterations as f64
        );
    }
}
