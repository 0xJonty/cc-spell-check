# cc-spell-check

Live spell check for the Claude Code terminal. The desktop app has spell check in its input box; the terminal TUI does not — this plugin adds it.

> Note: Claude Code also ships a native `spellcheck` setting (underline-only, off by default):
> `{ "spellcheck": { "enabled": true, "checker": "aspell", "language": "en_AU" } }` in `~/.claude/settings.json`.
> This plugin goes further: fix-suggestion buttons above the prompt, a persistent personal
> dictionary, and a `/spell` command. Enable one or the other, not both (double underlines).

- Red underlines on misspelled words as you type, painted directly in the prompt box (`prompt.edit` decorations).
- A suggestion band above the prompt with fix buttons and an add-to-dictionary button.
- `/spell` command: `on | off | status | add <word> | remove <word>`.
- Dictionary from `aspell dump master` (default lang `en_AU`, configurable in `/config`), with a hunspell wordlist fallback. Personal dictionary persisted across sessions.
- The submitted prompt is never rewritten — spell check is visual only.

## Requirements

- Claude Code >= 2.1.x (function-hooks plugin API)
- `aspell` + an aspell dictionary (`sudo apt install aspell aspell-en`)

## Install

Add to `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/home/jonty/claude-plugins/cc-spell-check" } }
```

or launch with `claude --plugin-dir /home/jonty/claude-plugins/cc-spell-check`.

## Development

```sh
claude plugin validate .
claude plugin test .
npx -y -p typescript tsc -p . --noEmit   # after first load has generated .claude-plugin/types/
# (bare `npx tsc` resolves to a decoy npm package named "tsc" — always pin -p typescript)
```
