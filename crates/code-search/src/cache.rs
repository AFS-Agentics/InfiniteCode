use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::files::FileManifestEntry;
use crate::types::{Chunk, CodeSearchError, ContentFilter};

const CACHE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CachedPayload {
    pub cache_version: u32,
    pub root: PathBuf,
    pub content: ContentFilter,
    pub model_id: String,
    pub manifest: Vec<FileManifestEntry>,
    pub chunks: Vec<Chunk>,
    pub embeddings: Vec<Vec<f32>>,
}

impl CachedPayload {
    pub fn new(
        root: PathBuf,
        content: ContentFilter,
        model_id: String,
        manifest: Vec<FileManifestEntry>,
        chunks: Vec<Chunk>,
        embeddings: Vec<Vec<f32>>,
    ) -> Self {
        Self {
            cache_version: CACHE_VERSION,
            root,
            content,
            model_id,
            manifest,
            chunks,
            embeddings,
        }
    }

    pub fn is_valid_for(
        &self,
        root: &Path,
        content: ContentFilter,
        model_id: &str,
        manifest: &[FileManifestEntry],
    ) -> bool {
        self.cache_version == CACHE_VERSION
            && self.root == root
            && self.content == content
            && self.model_id == model_id
            && self.manifest == manifest
            && self.chunks.len() == self.embeddings.len()
    }
}

pub fn default_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("devo")
        .join("code-search")
        .join("indexes")
}

pub fn cache_file_path(
    cache_dir: &Path,
    root: &Path,
    content: ContentFilter,
    model_id: &str,
) -> PathBuf {
    cache_dir.join(format!("{}.json", cache_key(root, content, model_id)))
}

pub fn load_payload(path: &Path) -> Option<CachedPayload> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn save_payload(path: &Path, payload: &CachedPayload) -> Result<(), CodeSearchError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes =
        serde_json::to_vec(payload).map_err(|error| CodeSearchError::Io(error.to_string()))?;
    std::fs::write(path, bytes)?;
    Ok(())
}

fn cache_key(root: &Path, content: ContentFilter, model_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(root.to_string_lossy().as_bytes());
    hasher.update(format!("{content:?}").as_bytes());
    hasher.update(model_id.as_bytes());
    let digest = hasher.finalize();
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    /// Trace: L2-DES-TOOL-001
    /// Verifies: cache payload validity depends on model, content filter, and file manifest.
    #[test]
    fn cached_payload_validates_manifest_and_model() {
        let manifest = vec![FileManifestEntry {
            path: PathBuf::from("src/lib.rs"),
            size: 10,
            modified_unix_nanos: 1,
        }];
        let payload = CachedPayload::new(
            PathBuf::from("/repo"),
            ContentFilter::Code,
            "model-a".to_string(),
            manifest.clone(),
            Vec::new(),
            Vec::new(),
        );

        assert_eq!(
            payload.is_valid_for(
                Path::new("/repo"),
                ContentFilter::Code,
                "model-a",
                &manifest
            ),
            true
        );
        assert_eq!(
            payload.is_valid_for(
                Path::new("/repo"),
                ContentFilter::Code,
                "model-b",
                &manifest
            ),
            false
        );
    }
}
