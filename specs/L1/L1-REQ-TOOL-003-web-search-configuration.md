---
artifact_id: L1-REQ-TOOL-003
revision: 1
status: Draft
active_baseline: no
supersedes:
superseded_by:
owner: Human
last_updated: 2026-05-21
---

# L1-REQ-TOOL-003 — Web Search Configuration

## Purpose

Ensure that web search is available as a critical tool capability and that users can configure how the program performs web search.

## Background / Context

Web search is a critical component for agentic work that depends on current external information, documentation, vendor behavior, ecosystem state, or public web references.

Different execution paths may be appropriate for different users and environments. Some model providers offer cloud-based web search services. Other users may prefer or require a locally configured search path using services such as DuckDuckGo, Tavily, Google, or another search provider. The exact implementation details for local search paths are not settled in this L1 requirement, but the program capability should be prioritized.

## User / Business Requirement

The program must support configurable web search execution so the user can choose or understand which web search path is used.

## Functional Requirements

- The program must treat web search as a first-class tool capability where enabled.
- The user must be able to configure how web search is executed.
- Web search configuration must support cloud-based provider search where available, such as search services exposed by model providers.
- Web search configuration should support local or independently configured search paths where available, such as DuckDuckGo, Tavily, Google, or another search provider.
- The program must make the currently effective web search configuration visible to the user.
- If web search is disabled, the program must not expose a web search capability to the model. If web search is enabled but unavailable or misconfigured, the program must report that state clearly instead of pretending search results exist.
- Web search execution must respect the same safety, permission, privacy, and observability requirements as other tools.

## Non-Functional Requirements

- Web search configuration must be durable across restarts where configured as a persistent preference.
- Web search behavior must be auditable enough for the user to understand which search path produced a result.
- Provider-specific search behavior must not prevent the program from supporting alternative search paths.
- Search configuration errors must be actionable.

## Acceptance Criteria

- Given web search is enabled through a cloud-based model provider search service, when the program needs current web information, then it can use that configured search path.
- Given web search is configured through a local or independently configured search provider, when the program needs current web information, then it can use that configured search path where available.
- Given multiple web search paths are available, when the user inspects configuration, then the user can identify which path is active.
- Given web search is disabled, when a task runs, then the program does not provide web search capability to the model.
- Given web search is enabled but unavailable or missing required credentials, when a task requires web search, then the program reports the configuration gap rather than fabricating results.
- Given a web search result is used in a task, when the user reviews tool activity or diagnostics, then the program can identify the search path used.

## Out of Scope

- This requirement does not define exact web search provider protocols, ranking behavior, result schema, crawling behavior, or local search implementation details.
- This requirement does not require every possible search provider to be supported.
- This requirement does not require web search to bypass network, privacy, permission, or provider policy restrictions.

## Open Questions

- Which web search paths are mandatory for the first usable milestone?
- Which cloud-based model-provider search services should be supported first?
- Which local or independently configured search providers should be supported first?
- Should web search configuration be global, workspace-specific, session-specific, or overridable per turn?

## Traceability

| Relationship | Target ID | Target Revision | Target Path | Rationale |
|---|---|---:|---|---|
| refined-by | TBD | TBD | specs/L2/tool/TBD.md | L2 design has not been authored yet. |

## Revision Notes

| Revision | Date | Author | Change Type | Notes |
|---:|---|---|---|---|
| 1 | 2026-05-21 | Assistant | Initial | Initial draft from approved user requirement. |
