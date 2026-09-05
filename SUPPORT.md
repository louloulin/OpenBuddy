# Support

**English** · [简体中文](SUPPORT.zh-CN.md)

### Before you ask

1. **Read the docs** — most questions are answered in [`docs/`](docs/). Start with [`docs/FAQ.md`](docs/FAQ.md) and [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md).
2. **Search existing issues** — someone may have hit the same snag. Use [GitHub search](https://github.com/louloulin/OpenBuddy/issues?q=is%3Aissue).
3. **Try the latest release** — your bug may already be fixed.

### Where to ask

| Question type | Best channel |
|---|---|
| 🐛 Bug report | [GitHub Issues](https://github.com/louloulin/OpenBuddy/issues/new?template=bug_report.md) |
| 💡 Feature request | [GitHub Issues](https://github.com/louloulin/OpenBuddy/issues/new?template=feature_request.md) |
| ❓ "How do I…" | [GitHub Discussions › Q&A](https://github.com/louloulin/OpenBuddy/discussions/categories/q-a) |
| 🧩 Plugin / extension dev | [GitHub Discussions › Plugins](https://github.com/louloulin/OpenBuddy/discussions/categories/plugins) |
| 🔬 Research / eval | [GitHub Discussions › Research](https://github.com/louloulin/OpenBuddy/discussions/categories/research) |
| 💬 Real-time chat | [Discord](https://discord.gg/openbuddy) |
| 🔏 Security disclosure | See [`SECURITY.md`](SECURITY.md) — **do not** open public issues |
| 💼 Commercial / enterprise | `hello@openbuddy.dev` |

### When opening a bug report

Please include:

- **OpenBuddy version** — Help → About (or `cat package.json | grep version`)
- **OS + version** — `winver`, `sw_vers`, or `uname -a`
- **Provider** — Anthropic / OpenAI / NewAPI / other (omit keys!)
- **Reproduction steps** — minimal steps that trigger the bug
- **Expected vs actual behavior**
- **Logs** — `~/Library/Logs/OpenBuddy/`, `%APPDATA%\OpenBuddy\logs\`, or `~/.config/OpenBuddy/logs/`
- **Screenshots / screen recording** if relevant

Use the [bug report template](https://github.com/louloulin/OpenBuddy/issues/new?template=bug_report.md) — it auto-fills most of the above.

### Response time SLA

We are a community-driven project. Best-effort response times:

- **Security** — see [`SECURITY.md`](SECURITY.md)
- **Bug reports with reproduction** — usually within 1 week
- **Feature requests** — usually within 2 weeks (may be deferred to roadmap)
- **Q&A discussions** — usually within 2 business days

### Paid support

If you need guaranteed-SLA commercial support, contact `enterprise@openbuddy.dev` — we maintain a list of community consultants and partner integrators.

### Localization

The current UI is shipped in:

- 🇬🇧 English (default)
- 🇨🇳 简体中文

Want to add your language? See [`docs/I18N.md`](docs/I18N.md) for the localization workflow.
