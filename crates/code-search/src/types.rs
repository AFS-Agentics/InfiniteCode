use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const DEFAULT_TOP_K: usize = 5;
pub const MAX_TOP_K: usize = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentFilter {
    Code,
    Docs,
    Config,
    All,
}

impl Default for ContentFilter {
    fn default() -> Self {
        Self::Code
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentKind {
    Code,
    Docs,
    Config,
    Data,
}

impl ContentKind {
    pub fn is_selected_by(self, filter: ContentFilter) -> bool {
        match filter {
            ContentFilter::Code => self == Self::Code,
            ContentFilter::Docs => self == Self::Docs,
            ContentFilter::Config => self == Self::Config,
            ContentFilter::All => self != Self::Data,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodeSearchOperation {
    Search,
    FindRelated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Chunk {
    pub content: String,
    pub file_path: PathBuf,
    pub start_line: usize,
    pub end_line: usize,
    pub language: String,
}

impl Chunk {
    pub fn location(&self) -> String {
        format!(
            "{}:{}-{}",
            self.file_path.to_string_lossy().replace('\\', "/"),
            self.start_line,
            self.end_line
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchResult {
    pub score: f32,
    pub chunk: Chunk,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndexStats {
    pub indexed_files: usize,
    pub total_chunks: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchOutput {
    pub operation: CodeSearchOperation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    pub root: PathBuf,
    pub content: ContentFilter,
    pub results: Vec<SearchResult>,
    pub index_stats: IndexStats,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchFilters {
    pub paths: Vec<String>,
    pub languages: Vec<String>,
}

impl SearchFilters {
    pub fn empty() -> Self {
        Self {
            paths: Vec::new(),
            languages: Vec::new(),
        }
    }

    pub fn normalized(paths: Vec<String>, languages: Vec<String>) -> Self {
        Self {
            paths: paths
                .into_iter()
                .map(|path| path.replace('\\', "/").trim_matches('/').to_lowercase())
                .filter(|path| !path.is_empty())
                .collect(),
            languages: languages
                .into_iter()
                .map(|language| language.trim().to_lowercase())
                .filter(|language| !language.is_empty())
                .collect(),
        }
    }

    pub fn allows(&self, chunk: &Chunk) -> bool {
        let path = chunk
            .file_path
            .to_string_lossy()
            .replace('\\', "/")
            .to_lowercase();
        let path_allowed = self.paths.is_empty()
            || self
                .paths
                .iter()
                .any(|filter| path == *filter || path.starts_with(&format!("{filter}/")));
        let language_allowed = self.languages.is_empty()
            || self
                .languages
                .iter()
                .any(|language| language == &chunk.language.to_lowercase());
        path_allowed && language_allowed
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchRequest {
    pub root: PathBuf,
    pub query: String,
    pub content: ContentFilter,
    pub top_k: usize,
    pub filters: SearchFilters,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelatedRequest {
    pub root: PathBuf,
    pub file_path: PathBuf,
    pub line: usize,
    pub content: ContentFilter,
    pub top_k: usize,
    pub filters: SearchFilters,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum CodeSearchError {
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("model unavailable: {0}")]
    ModelUnavailable(String),
    #[error("index error: {0}")]
    Index(String),
    #[error("I/O error: {0}")]
    Io(String),
}

impl From<std::io::Error> for CodeSearchError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

impl From<anyhow::Error> for CodeSearchError {
    fn from(error: anyhow::Error) -> Self {
        Self::Index(error.to_string())
    }
}

pub fn validate_top_k(top_k: usize) -> Result<usize, CodeSearchError> {
    if top_k == 0 {
        return Err(CodeSearchError::InvalidInput(
            "`top_k` must be greater than zero".to_string(),
        ));
    }
    if top_k > MAX_TOP_K {
        return Err(CodeSearchError::InvalidInput(format!(
            "`top_k` must be less than or equal to {MAX_TOP_K}"
        )));
    }
    Ok(top_k)
}
