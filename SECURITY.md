# Security

If you find a vulnerability, **do not** open a public issue.

Use [GitHub private vulnerability reporting](https://github.com/AidenHadisi/buildsmith/security/advisories/new) on this repository.

Please include:

- Affected package or surface (web, MCP, CLI, store)
- Steps to reproduce
- Impact

This is a local developer tool. It reads and writes files under a project’s `.buildsmith/` directory and may run as an MCP server spawned by an editor. Treat prompt injection and unexpected file writes as in-scope.
