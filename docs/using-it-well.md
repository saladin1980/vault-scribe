# Using it well

vault-scribe works with no effort from you. A few habits make what it writes far more useful.

## Say the why out loud

The scribe records *why* a change was made from your words or Claude's stated reason. "Fix the form" gives it nothing; "fix the form, bots are flooding it" gives it the why that you will want in six months. One clause is enough.

## Make decisions in your own words

A decision is only recorded when it quotes something you typed. So when Claude proposes something and you agree, say what you're agreeing to:

- weak: "ok" (it gets filed as "proposed, not confirmed")
- strong: "yes, use the honeypot, no captcha" (recorded as your decision, with that quote)

This is deliberate. It is the difference between a log of what you decided and a log of what an assistant suggested.

## Let disagreements stand

When you push back ("no, the reverse", "not yet"), the rejected idea goes under Discussions with the reason. That's valuable: it stops the same idea being re-proposed next month as if new. You don't have to do anything; just push back in words.

## Keep the project table honest

Cross-project signals are only as good as the table in your config note:
- add a row when you start a project (the new project checklist reminds you, if you set `memory_folder_name`)
- list every place a project's code lives, including second clones
- list hosts and domains: a session that ssh's into a server is working on whatever lives there, even if it never mentions the project

A good table is what lets the scribe notice that work in one project changed something another one depends on.

## Read the heads-up

When a band says another session changed something your project depends on, believe it before you trust your project's notes. Those notes may be stale until the change is reviewed.

## Review signals regularly

Signals pile up if nobody acts on them. A short weekly pass is enough (see [the review loop](review-workflow.md)). Mark each one processed, routed or dropped on its heading line, and the heads-up clears itself. Dropping noisy signals with a reason also helps you spot a project-table row that is too broad.

## Use the push policy for what it is good at

Hold the pushes you cannot take back: production deploys, public repos, force pushes. Announce the ones where pushing is how you test (a bot that only runs on its server, a staging branch), so you hear what went out without being blocked. Holding everything just teaches everyone to click through.

When a push is held, the approval has to be clear: "ship it", "push it", "go ahead and push". "Go ahead" on its own approves the work, not the push.

## Pick the summary model to match your sessions

`scribe_model: haiku` is cheap and fine for most days. If your sessions are long and dense and the summaries miss nuance, try a stronger model in the config note. It's a one-line change, and nothing in the code needs to know.

## Trust, but skim

Once a day, skim the scribe's block for the session that mattered most. If something is wrong, fix it in the note: it's your vault. If the same kind of mistake keeps happening, open an issue with the example. That is exactly how the quote check for decisions and the "reads are not changes" rule came to exist.

## What it will not do for you

- **Update your project memory notes.** It nudges the session to do it while the context is fresh, because unsupervised summaries writing into your knowledge base is how invented facts get in.
- **Decide what is important.** It records; you curate.
- **Replace your permissions.** Guards are a safety net for a few known-dangerous writes, not a security boundary.
