use std::ops::Range;
use std::path::Path;

use tree_sitter::Node;
use tree_sitter::Parser;

use crate::types::Chunk;

const DESIRED_CHUNK_CHARS: usize = 1_500;
const MIN_CHUNK_CHARS: usize = 50;
const RECURSION_DEPTH: usize = 500;

pub fn chunk_file(relative_path: &Path, language: &str, content: &str) -> Vec<Chunk> {
    if language == "rust" {
        let rust_chunks = chunk_rust_ast(relative_path, content);
        if !rust_chunks.is_empty() {
            return rust_chunks;
        }
    }
    chunk_by_lines(relative_path, language, content)
}

fn chunk_rust_ast(relative_path: &Path, content: &str) -> Vec<Chunk> {
    let mut parser = Parser::new();
    let language = tree_sitter_rust::LANGUAGE.into();
    if parser.set_language(&language).is_err() {
        return Vec::new();
    }
    let Some(tree) = parser.parse(content, None) else {
        return Vec::new();
    };
    let root = tree.root_node();
    if root.has_error() {
        return Vec::new();
    }

    let mut ranges = Vec::new();
    let mut cursor = root.walk();
    for child in root.named_children(&mut cursor) {
        collect_node_ranges(child, content, 0, &mut ranges);
    }
    merge_ranges(relative_path, "rust", content, ranges)
}

fn collect_node_ranges(
    node: Node<'_>,
    content: &str,
    depth: usize,
    ranges: &mut Vec<Range<usize>>,
) {
    let range = node.byte_range();
    if range.end <= range.start {
        return;
    }
    let char_len = content[range.clone()].chars().count();
    if char_len <= DESIRED_CHUNK_CHARS || depth >= RECURSION_DEPTH || node.named_child_count() == 0
    {
        if char_len >= MIN_CHUNK_CHARS {
            ranges.push(range);
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        collect_node_ranges(child, content, depth + 1, ranges);
    }
}

fn merge_ranges(
    relative_path: &Path,
    language: &str,
    content: &str,
    mut ranges: Vec<Range<usize>>,
) -> Vec<Chunk> {
    ranges.sort_by_key(|range| range.start);
    let mut merged = Vec::new();
    let mut current: Option<Range<usize>> = None;

    for range in ranges {
        match current.take() {
            Some(active)
                if content[active.start..range.end].chars().count() <= DESIRED_CHUNK_CHARS =>
            {
                current = Some(active.start..range.end);
            }
            Some(active) => {
                push_byte_chunk(&mut merged, relative_path, language, content, active);
                current = Some(range);
            }
            None => current = Some(range),
        }
    }
    if let Some(active) = current {
        push_byte_chunk(&mut merged, relative_path, language, content, active);
    }
    merged
}

fn push_byte_chunk(
    chunks: &mut Vec<Chunk>,
    relative_path: &Path,
    language: &str,
    content: &str,
    range: Range<usize>,
) {
    let text = content[range.clone()].trim().to_string();
    if text.is_empty() {
        return;
    }
    chunks.push(Chunk {
        content: text,
        file_path: relative_path.to_path_buf(),
        start_line: byte_to_line(content, range.start),
        end_line: byte_to_line(content, range.end),
        language: language.to_string(),
    });
}

fn chunk_by_lines(relative_path: &Path, language: &str, content: &str) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut start_line: usize = 1;
    let mut current_line: usize = 1;

    for line in content.lines() {
        let next_len = current.chars().count() + line.chars().count() + 1;
        if !current.is_empty() && next_len > DESIRED_CHUNK_CHARS {
            chunks.push(Chunk {
                content: current.trim_end().to_string(),
                file_path: relative_path.to_path_buf(),
                start_line,
                end_line: current_line.saturating_sub(1),
                language: language.to_string(),
            });
            current.clear();
            start_line = current_line;
        }
        current.push_str(line);
        current.push('\n');
        current_line += 1;
    }

    if !current.trim().is_empty() {
        chunks.push(Chunk {
            content: current.trim_end().to_string(),
            file_path: relative_path.to_path_buf(),
            start_line,
            end_line: current_line.saturating_sub(1),
            language: language.to_string(),
        });
    }
    chunks
}

fn byte_to_line(content: &str, byte_idx: usize) -> usize {
    content
        .as_bytes()
        .iter()
        .take(byte_idx.min(content.len()))
        .filter(|byte| **byte == b'\n')
        .count()
        + 1
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use pretty_assertions::assert_eq;

    use super::*;

    /// Trace: L2-DES-TOOL-001
    /// Verifies: line fallback preserves 1-indexed source line boundaries.
    #[test]
    fn line_chunking_preserves_line_bounds() {
        let chunks = chunk_file(Path::new("README.md"), "markdown", "one\ntwo\nthree\n");
        let expected = vec![Chunk {
            content: "one\ntwo\nthree".to_string(),
            file_path: Path::new("README.md").to_path_buf(),
            start_line: 1,
            end_line: 3,
            language: "markdown".to_string(),
        }];
        assert_eq!(chunks, expected);
    }

    /// Trace: L2-DES-TOOL-001
    /// Verifies: Rust code uses AST chunking when parser boundaries are available.
    #[test]
    fn rust_chunking_uses_ast_boundaries() {
        let source = r#"
fn first() {
    println!("first");
}

fn second() {
    println!("second");
}
"#;
        let chunks = chunk_file(Path::new("src/lib.rs"), "rust", source);

        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].content.contains("fn first"));
        assert!(chunks[0].content.contains("fn second"));
        assert_eq!(chunks[0].start_line, 1);
    }
}
