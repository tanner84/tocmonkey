# TOC Monkey Repository Instructions

## Protect the public face

The current public face of TOC Monkey must be preserved by default.

The "public face" includes all visitor-visible design and behavior, including layout, colors, typography, wording, branding, navigation, map presentation, controls, public URLs, and the way public features behave.

Before making any public-facing change, the agent must:

1. Tell Tanner exactly what visitors will see or experience differently.
2. Explain why the public-facing change is needed.
3. Obtain Tanner's explicit approval for that specific change.

Do not bundle an unapproved public-facing change into a backend, security, cost-control, refactoring, dependency, or infrastructure change. If a technical fix cannot be completed without changing the public face, stop and request approval.

Internal changes that do not alter the visitor experience may be prepared on a separate branch. Use a preview or pull request for review, and do not merge or deploy changes to the public site without Tanner's explicit approval.

## Safe defaults

- Preserve existing public behavior unless a change is explicitly approved.
- Work on a separate branch; do not commit directly to `main`.
- Never commit API keys, passwords, tokens, or other secrets.
- Summarize testing, risks, and any expected operational effect before requesting approval to merge.
