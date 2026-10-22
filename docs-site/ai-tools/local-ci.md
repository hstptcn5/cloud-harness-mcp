---
title: Local Docker CI (experimental)
description: Optional local Docker CI orchestration through Cloud Harness MCP without GitHub-hosted Actions minutes.
---

# Local Docker CI (experimental)

CloudHarness supports a staged, opt-in local CI workflow. M1 has been verified on the owner's Docker Desktop with 21/21 Node tests, without GitHub Actions. The optional `ci_run`, `ci_status` and `ci_report` MCP tools are added on the experimental M2.2 branch and **have not been deployed or verified from a real connected ChatGPT client**.

The operator must configure a private CI broker on the existing trusted Docker network. It is disabled by default, accepts only operator-approved repository IDs and Node profiles, and requires a separate CI-only token. The broker/CI worker never receives CloudHarness Runner or GitHub credentials. A CI run returns an ID, which the client can use to poll and retrieve a structured report.

This initial integration is suitable only for explicitly trusted Node repositories. The CI worker executes npm scripts; do not test untrusted fork PRs, expose a public broker port, or turn off GitHub required checks based on these early tests. iOS, Android, Go and browser validation are not yet covered.

The authoritative operator setup and remaining security/test gates are in the repository's `docs/local-ci-runner-integration.md`. It must pass full verification and owner-side Docker acceptance before enabling.
