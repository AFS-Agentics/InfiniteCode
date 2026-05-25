---
artifact_id: L1-REQ-CLIENT-001
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-23
---

# L1-REQ-CLIENT-001 — Localization Readiness

## Purpose

Ensure that client interfaces are usable with non-English user content and can support full UI localization in the future.

## Background / Context

The initial product may use English UI text, but users may write prompts, file paths, tool output, provider messages, and transcript content in many languages. Client interfaces must not fail on Unicode input, IME composition, CJK display width, non-ASCII paths, or localized external output.

Full translation of every UI string is useful, but it does not need to block the first milestone if the clients are structured so localization can be added later.

## User / Business Requirement

The program must be locale-safe for user content and localization-ready for future translated client interfaces.

## Functional Requirements

- Client interfaces must correctly accept and display Unicode user input.
- Client interfaces must support IME composition in supported environments.
- Client interfaces must preserve non-ASCII file paths, command output, provider responses, and transcript content.
- Client interfaces must handle CJK and other wide-character text without corrupting input, cursor behavior, transcript layout, or visible state.
- User-visible client strings should be centralized or structured so they can be translated in a future localization milestone.
- The initial product may ship with English UI text only.

## Non-Functional Requirements

- Locale-safe behavior is required even when full UI translation is not yet implemented.
- Localization readiness must not compromise safety, error clarity, or command discoverability.
- Future UI translation should not require rewriting core client workflows.
- Display behavior must remain readable when localized or non-ASCII content is longer than equivalent English text.

## Acceptance Criteria

- Given the user enters non-English text, when the client accepts input, then the submitted message preserves that text.
- Given the user enters text through an IME in a supported environment, when composition completes, then the client preserves the composed text.
- Given a file path contains non-ASCII characters, when the client displays or references the path, then the path remains readable and intact.
- Given provider or tool output contains localized or non-ASCII text, when it appears in the transcript, then the client renders it without corrupting layout.
- Given full UI localization is not implemented, when developers add or review client UI strings, then the code structure does not make future localization unnecessarily difficult.

## Out of Scope

- Complete translated UI catalogs are not required by this L1 requirement.
- Locale detection, translation file formats, pluralization rules, string extraction tooling, and i18n library choice are not specified here.
- This requirement does not guarantee identical IME or wide-character behavior in unsupported terminal or client environments.

## Open Questions

- Which UI languages should be supported after the initial English-only milestone?
- Which client environments are required to support IME input?
- What minimum layout guarantees should apply to CJK and other wide-character text?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refined-by | L2-DES-CLIENT-001 | 1 | specs/L2/client/L2-DES-CLIENT-001-localization-readiness.md | Defines Unicode-safe input, IME composition, display-width aware rendering, non-ASCII path handling, diagnostics, and future UI string translation structure. |
| related-to | L2-DES-TUI-002 | 1 | specs/L2/tui/L2-DES-TUI-002-modern-tui-shell-layout.md | TUI layout must account for Unicode and localized display width. |
| related-to | L2-DES-TUI-003 | 1 | specs/L2/tui/L2-DES-TUI-003-composer-and-input-modes.md | Composer and input mode handling must preserve Unicode and IME input. |
| related-to | L2-DES-TUI-004 | 1 | specs/L2/tui/L2-DES-TUI-004-streaming-transcript-and-state.md | Transcript and streaming output must preserve localized and non-ASCII content. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-21 | Assistant | Initial | Initial draft approved for L1 expansion. |
