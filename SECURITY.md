# Security policy

Please **do not** open a public issue for security problems.

Report privately through GitHub: **Security > Report a vulnerability** on this repository ([direct link](https://github.com/mjn81/cove-chat/security/advisories/new)). Include what you found, steps to reproduce, the affected version and the impact you expect.

We will acknowledge the report, work on a fix, and credit you in the release notes if you wish.

## Supported versions

Only the latest release receives security fixes. Please update before reporting and confirm the problem still exists.

| Version | Supported |
|---|---|
| Latest release (`0.11.x`) | Yes |
| Older releases | No |

## Scope

Cove is **server-trusted**: the server operator manages channel keys and can read non-Whisper messages. That is a documented design choice, not a vulnerability. See the docs page *Security > Encryption model*.

Problems in third-party dependencies are welcome too, but report them to the upstream project first when they are not specific to how Cove uses them.
