# cc-spell-check

Live spell check, fix suggestions, and a personal dictionary for the Claude Code terminal.

> Note: Claude Code also ships a native `spellcheck` setting (underline-only, off by default):
> `{ "spellcheck": { "enabled": true, "checker": "aspell", "language": "en_AU" } }` in `~/.claude/settings.json`.
> This plugin goes further: fix-suggestion buttons above the prompt, a persistent personal
> dictionary, and a `/spell` command. Enable one or the other, not both (double underlines).

- Red underlines on misspelled words as you type. Orange underlines mark contractions with a missing apostrophe.
- The suggestion band shows up to three fixes by default. Set `maxSuggestions` from 1 to 9 in `/config`.
- Use `/spell on`, `/spell off`, and `/spell status` to control spell check. Use `/spell add <word>` and `/spell remove <word>` to edit your personal dictionary.
- Use `/spell fix recieve receive` to give a flagged typo a preferred correction. `/spell unfix recieve` removes the preference, and `/spell list` shows your personal dictionary and correction overrides.
- The dictionary language defaults to `en_AU` and is configurable in `/config`. `/spell status` reports the loaded dictionary and language.
- The personal dictionary persists across sessions. Suggestions change the draft only when selected.

## Requirements

- Claude Code **2.1.332 or later**. Version 2.1.332 is the tested baseline for the function hooks and prompt-painting API.
- Aspell and a dictionary for the selected language. On Debian or Ubuntu, run `sudo apt install aspell aspell-en` for English.
- The optional Hunspell fallback uses `unmunch` from `hunspell-tools` and matching UTF-8 `.dic` and `.aff` files for the configured locale. For US English on Debian or Ubuntu, install `hunspell-tools hunspell-en-us` and select `en_US`. The plugin checks `/usr/share/hunspell`, `/usr/local/share/hunspell`, and `/opt/homebrew/share/hunspell`.

## Install

```sh
git clone https://github.com/0xJonty/cc-spell-check.git
cd cc-spell-check
claude --plugin-dir .
```

For automatic loading, add the absolute path to your checkout under `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`.

## Development

```sh
claude plugin validate .
claude plugin test .
npx -y -p typescript tsc -p . --noEmit   # after first load has generated .claude-plugin/types/
# (bare `npx tsc` resolves to a decoy npm package named "tsc" — always pin -p typescript)
```
