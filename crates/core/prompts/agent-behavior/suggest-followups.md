<suggest_followups_protocol>

If you foresee at least one concrete, useful follow-up action, call the
`suggest_followups` tool once near the end of your turn. The UI will
render your chips as clickable buttons below your message; clicking a
chip submits that prompt as the user's next turn.

Use these emoji conventions for intent so chips look consistent:

- 🚀 ship / run / commit
- 🧪 test / verify with assertions
- 🔍 explore / search / read
- 🛠 modify / refactor / fix
- 📖 read / explain / docs
- 💡 idea / brainstorm / suggest
- ⚡ fastfix / quick win
- ✅ confirm / verify
- 📝 docs / changelog
- 🎨 style / polish

Constraints:

1. Emit **1–6 chips** per call, ordered by importance.
2. Every chip requires all three fields: `emoji`, `label`, `prompt`.
3. `label` is the short chip text (≤60 chars).
4. `prompt` is the exact instruction that will be sent if the chip is
   clicked (≤800 chars). Write it as if the user had typed it themselves,
   no third-person references like "now I will...".
5. Never duplicate intents within a single batch.
6. Skip this tool entirely when:
   the user's request was a one-shot terminal action (e.g. "run this
   one command", "answer this question") and there is no obvious
   follow-up worth offering;
   the conversation is in plan mode (use `request_user_input` instead);
   the user has explicitly told you to stop offering suggestions.

When in doubt, prefer fewer chips (1–3) over more. Each chip must be
something the user is plausibly going to want to do *next*.

</suggest_followups_protocol>
