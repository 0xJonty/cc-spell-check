# cc-spell-check

Live spell check for the Claude Code terminal. Catch typos as you type, apply a suggested fix from the prompt, and keep a personal dictionary across sessions.

## Quick start

You’ll need Git, **Claude Code 2.1.332 or later**, and Aspell with a dictionary for your language. The plugin defaults to Australian English (`en_AU`).

On Debian or Ubuntu, install Aspell and its English dictionaries.

```sh
sudo apt install aspell aspell-en
```

Clone the plugin and launch Claude Code from the checkout.

```sh
git clone https://github.com/0xJonty/cc-spell-check.git
cd cc-spell-check
claude --plugin-dir .
```

In Claude Code, run **`/spell status`** to check the dictionary. Type `teh ` with a trailing space to see a suggestion.

### Install with a coding agent

Paste this prompt into Claude Code, Codex, or another coding agent with terminal access.

```text
Install cc-spell-check for my Claude Code terminal from
https://github.com/0xJonty/cc-spell-check.git.

Check that Claude Code is version 2.1.332 or later. Check that Aspell
and the en_AU dictionary are available, and help install them for my OS
if needed. Clone the repo into a dedicated directory outside any project
I'm working on. Run claude plugin validate against that directory.

Add the checkout's absolute path to env.CLAUDE_CODE_PLUGIN_DIRS in my
Claude Code user settings. Preserve my existing settings and any plugin
paths already configured. Tell me where the plugin was installed, then
show me how to restart Claude Code and check it with /spell status.
```

### Load it automatically

To load the plugin in new Claude Code sessions, add the checkout’s absolute path to `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`. Merge it into your existing settings and restart Claude Code.

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/absolute/path/to/cc-spell-check"
  }
}
```

## Use spell check

**Red** underlines mark spelling errors. **Orange** underlines mark contractions with a missing apostrophe. Click a fix above the prompt, or press `Ctrl+X` then `Tab` to focus the suggestions and select a numbered fix. Choose `+dict` to remember a word.

| Command | What it does |
| --- | --- |
| `/spell status` | Show whether spell check is on and which dictionary loaded |
| `/spell on` or `/spell off` | Toggle spell check for this session |
| `/spell add <word>` or `/spell remove <word>` | Edit your personal dictionary |
| `/spell list` | Show your saved words and custom corrections |
| `/spell fix teh the` | Put `the` first in the suggestions for `teh` |
| `/spell unfix teh` | Remove that custom correction |

## Settings

Use **`/config`** to set the plugin defaults.

| Setting | Default | What it controls |
| --- | --- | --- |
| `lang` | `en_AU` | Dictionary locale. Run `aspell dicts` to see the dictionaries available on your system. |
| `enabled` | `true` | Whether spell check starts on in new sessions |
| `maxSuggestions` | `3` | Maximum fix buttons, from 1 to 9 |

If you use Claude Code’s native spell checker, disable it to avoid duplicate underlines.

### Optional Hunspell fallback

If Aspell cannot load the selected dictionary, the plugin tries to expand the same locale’s UTF-8 Hunspell `.dic` and `.aff` files with `unmunch`. It checks `/usr/share/hunspell`, `/usr/local/share/hunspell`, and `/opt/homebrew/share/hunspell`. On Debian or Ubuntu, install `hunspell-tools` and the dictionary package for your locale. For example, install `hunspell-en-us` and set `lang` to `en_US` for US English.

## Development

Run these from the checkout. Launch the plugin once to generate `.claude-plugin/types/` before running TypeScript.

```sh
claude plugin validate .
claude plugin test .
npx -y -p typescript tsc -p . --noEmit
```

## License

[MIT](LICENSE)
