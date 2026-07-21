# Project Context

## A-Ads Unit Assignments (All Placed ✅)
| Unit | Placement | Desktop | Website |
|:----:|-----------|---------|---------|
| 2448648 | Above MessageField | `chat-view.tsx` | home/landing |
| 2448649 | Splash / Loading | `startup-overlay.tsx` | home/landing/docs |
| 2448650 | Sidebar | `app-sidebar-content.tsx` | home/landing/docs |
| 2448651 | Settings | `settings-page.tsx` | home/landing |
| 2448652 | Search results | `mention-popover.tsx` | home/landing |
| 2448653 | Below response | `chat-turn.tsx` | home/landing |
| 2448654 | Above response | `chat-turn.tsx` | home/landing |
| 2448655 | Mid timeline | `chat-turn.tsx` | home/landing |
| 2448656 | Mid response | `chat-turn.tsx` | home/landing |
| 2448657 | Inline | `chat-turn.tsx` | home/landing |

## Active: Purging Adsterra from website
- Landing page: needs remaining 4 units (2448652, 2448650, 2448651, 2448648)
- `index.html`: remove Adsterra script (line 9) + all inline moderation JS (lines 10-199)
- `src/index.css`: remove Adsterra pill styles (lines 231-321)

## Git
- `ac46353` — feat(desktop): replace Adsterra with A-Ads, history-aware turn gating (pushed)
