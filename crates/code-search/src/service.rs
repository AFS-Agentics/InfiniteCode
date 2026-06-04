use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::cache::{cache_file_path, default_cache_dir, load_payload, save_payload};
use crate::dense::{EmbeddingProvider, Model2VecEmbeddingProvider};
use crate::files::discover_files;
use crate::index::SearchIndex;
use crate::ranking::rank_search;
use crate::types::{
    CodeSearchError, CodeSearchOperation, ContentFilter, IndexStats, RelatedRequest, SearchOutput,
    SearchRequest, validate_top_k,
};

pub struct CodeSearchService {
    provider: Arc<dyn EmbeddingProvider>,
    cache_dir: PathBuf,
    indexes: Mutex<HashMap<String, Arc<SearchIndex>>>,
}

impl CodeSearchService {
    pub fn production() -> Self {
        Self::new(
            Arc::new(Model2VecEmbeddingProvider::default()),
            default_cache_dir(),
        )
    }

    pub fn new(provider: Arc<dyn EmbeddingProvider>, cache_dir: PathBuf) -> Self {
        Self {
            provider,
            cache_dir,
            indexes: Mutex::new(HashMap::new()),
        }
    }

    pub fn search(&self, request: SearchRequest) -> Result<SearchOutput, CodeSearchError> {
        let top_k = validate_top_k(request.top_k)?;
        let root = canonical_root(&request.root)?;
        let query = request.query.trim().to_string();
        if query.is_empty() {
            return Ok(SearchOutput {
                operation: CodeSearchOperation::Search,
                query: Some(query),
                root,
                content: request.content,
                results: Vec::new(),
                index_stats: IndexStats {
                    indexed_files: 0,
                    total_chunks: 0,
                },
            });
        }
        let index = self.index(root, request.content)?;
        let query_embedding = self.provider.embed(std::slice::from_ref(&query))?;
        let results = query_embedding
            .first()
            .map(|embedding| rank_search(&index, &query, embedding, top_k, &request.filters))
            .unwrap_or_default();
        Ok(SearchOutput {
            operation: CodeSearchOperation::Search,
            query: Some(query),
            root: index.root().to_path_buf(),
            content: index.content(),
            results,
            index_stats: index.stats(),
        })
    }

    pub fn find_related(&self, request: RelatedRequest) -> Result<SearchOutput, CodeSearchError> {
        let top_k = validate_top_k(request.top_k)?;
        if request.line == 0 {
            return Err(CodeSearchError::InvalidInput(
                "`line` must be 1-indexed and greater than zero".to_string(),
            ));
        }
        let root = canonical_root(&request.root)?;
        let relative_path = normalize_source_path(&root, &request.file_path)?;
        let index = self.index(root, request.content)?;
        let source_idx = index.find_source_chunk(&relative_path, request.line);
        let results = source_idx
            .map(|idx| index.related_by_embedding(idx, top_k, &request.filters))
            .unwrap_or_default();
        Ok(SearchOutput {
            operation: CodeSearchOperation::FindRelated,
            query: None,
            root: index.root().to_path_buf(),
            content: index.content(),
            results,
            index_stats: index.stats(),
        })
    }

    fn index(
        &self,
        root: PathBuf,
        content: ContentFilter,
    ) -> Result<Arc<SearchIndex>, CodeSearchError> {
        let files = discover_files(&root, content)?;
        let manifest = files
            .iter()
            .map(|file| file.manifest.clone())
            .collect::<Vec<_>>();
        let key = memory_key(&root, content, self.provider.model_id());
        if let Some(index) = self
            .indexes
            .lock()
            .map_err(|_| CodeSearchError::Index("index cache lock poisoned".to_string()))?
            .get(&key)
            .filter(|index| index.manifest_matches(&manifest))
            .cloned()
        {
            return Ok(index);
        }

        let cache_path = cache_file_path(&self.cache_dir, &root, content, self.provider.model_id());
        if let Some(payload) = load_payload(&cache_path)
            && payload.is_valid_for(&root, content, self.provider.model_id(), &manifest)
        {
            let index = Arc::new(SearchIndex::from_payload(payload)?);
            self.indexes
                .lock()
                .map_err(|_| CodeSearchError::Index("index cache lock poisoned".to_string()))?
                .insert(key, Arc::clone(&index));
            return Ok(index);
        }

        let index = Arc::new(SearchIndex::build(
            root.clone(),
            content,
            &files,
            self.provider.as_ref(),
        )?);
        save_payload(&cache_path, &index.payload())?;
        self.indexes
            .lock()
            .map_err(|_| CodeSearchError::Index("index cache lock poisoned".to_string()))?
            .insert(key, Arc::clone(&index));
        Ok(index)
    }
}

impl Default for CodeSearchService {
    fn default() -> Self {
        Self::production()
    }
}

fn canonical_root(root: &Path) -> Result<PathBuf, CodeSearchError> {
    let canonical = root.canonicalize()?;
    if !canonical.is_dir() {
        return Err(CodeSearchError::InvalidInput(format!(
            "search root is not a directory: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
}

fn normalize_source_path(root: &Path, file_path: &Path) -> Result<PathBuf, CodeSearchError> {
    if file_path.is_absolute() {
        let canonical = file_path.canonicalize()?;
        return canonical
            .strip_prefix(root)
            .map(Path::to_path_buf)
            .map_err(|_| {
                CodeSearchError::InvalidInput(format!(
                    "file path is outside the search root: {}",
                    file_path.display()
                ))
            });
    }
    Ok(file_path.to_path_buf())
}

fn memory_key(root: &Path, content: ContentFilter, model_id: &str) -> String {
    format!("{}::{content:?}::{model_id}", root.display())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use pretty_assertions::assert_eq;

    use crate::dense::HashEmbeddingProvider;
    use crate::types::SearchFilters;

    use super::*;

    fn test_service(cache_dir: PathBuf) -> CodeSearchService {
        CodeSearchService::new(Arc::new(HashEmbeddingProvider::new("test", 16)), cache_dir)
    }

    /// Trace: L2-DES-TOOL-001
    /// Verifies: search returns the structured output shape with bounded result count.
    #[test]
    fn search_returns_structured_results() {
        let temp = tempfile::tempdir().expect("tempdir");
        let cache = tempfile::tempdir().expect("cache");
        fs::write(
            temp.path().join("parser.rs"),
            "pub fn parse_input() {}\npub fn render_output() {}\n",
        )
        .expect("write");
        let service = test_service(cache.path().to_path_buf());

        let output = service
            .search(SearchRequest {
                root: temp.path().to_path_buf(),
                query: "parse input".to_string(),
                content: ContentFilter::Code,
                top_k: 1,
                filters: SearchFilters::empty(),
            })
            .expect("search");

        assert_eq!(output.operation, CodeSearchOperation::Search);
        assert_eq!(output.results.len(), 1);
        assert_eq!(output.index_stats.indexed_files, 1);
    }

    /// Trace: L2-DES-TOOL-001
    /// Verifies: find-related excludes the source chunk and prefers same-language chunks.
    #[test]
    fn find_related_excludes_source_chunk() {
        let temp = tempfile::tempdir().expect("tempdir");
        let cache = tempfile::tempdir().expect("cache");
        fs::write(
            temp.path().join("lib.rs"),
            "pub fn parse_input() {}\n\npub fn parse_related() {}\n",
        )
        .expect("write");
        let service = test_service(cache.path().to_path_buf());

        let output = service
            .find_related(RelatedRequest {
                root: temp.path().to_path_buf(),
                file_path: PathBuf::from("lib.rs"),
                line: 1,
                content: ContentFilter::Code,
                top_k: 5,
                filters: SearchFilters::empty(),
            })
            .expect("related");

        assert_eq!(output.operation, CodeSearchOperation::FindRelated);
        assert!(
            output
                .results
                .iter()
                .all(|result| result.chunk.start_line != 1)
        );
    }

    /// Trace: L2-DES-TOOL-001
    /// Verifies: cache invalidates when the indexed file manifest changes.
    #[test]
    fn search_cache_invalidates_after_file_change() {
        let temp = tempfile::tempdir().expect("tempdir");
        let cache = tempfile::tempdir().expect("cache");
        let file = temp.path().join("lib.rs");
        fs::write(&file, "pub fn alpha() {}\n").expect("write");
        let service = test_service(cache.path().to_path_buf());

        let first = service
            .search(SearchRequest {
                root: temp.path().to_path_buf(),
                query: "alpha".to_string(),
                content: ContentFilter::Code,
                top_k: 5,
                filters: SearchFilters::empty(),
            })
            .expect("first search");
        fs::write(&file, "pub fn beta() {}\n").expect("rewrite");
        let second = service
            .search(SearchRequest {
                root: temp.path().to_path_buf(),
                query: "beta".to_string(),
                content: ContentFilter::Code,
                top_k: 5,
                filters: SearchFilters::empty(),
            })
            .expect("second search");

        assert_eq!(first.index_stats.indexed_files, 1);
        assert_eq!(second.results[0].chunk.content, "pub fn beta() {}");
    }
}
