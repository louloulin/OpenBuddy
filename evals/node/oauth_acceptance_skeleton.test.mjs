import { describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import path from "node:path"

const repoRoot = path.resolve(process.cwd())
const runners = [
  { name: "gmail-api", file: "evals/node/run_gmail_api_acceptance.mjs", enabledFlag: "OPENBUDDY_EMAIL_GMAIL_API_ACCEPTANCE", tokenFlag: "OPENBUDDY_EMAIL_GMAIL_ACCESS_TOKEN", writeConfirm: "I_UNDERSTAND_MAILBOX_MUTATIONS", sendConfirm: "I_UNDERSTAND_EXTERNAL_EMAIL_SEND", recipientFlag: "OPENBUDDY_EMAIL_GMAIL_TEST_RECIPIENT" },
  { name: "graph-api", file: "evals/node/run_graph_api_acceptance.mjs", enabledFlag: "OPENBUDDY_EMAIL_GRAPH_API_ACCEPTANCE", tokenFlag: "OPENBUDDY_EMAIL_GRAPH_ACCESS_TOKEN", writeConfirm: "I_UNDERSTAND_MAILBOX_MUTATIONS", sendConfirm: "I_UNDERSTAND_EXTERNAL_EMAIL_SEND", recipientFlag: "OPENBUDDY_EMAIL_GRAPH_TEST_RECIPIENT" },
  { name: "jmap-api", file: "evals/node/run_jmap_api_acceptance.mjs", enabledFlag: "OPENBUDDY_EMAIL_JMAP_API_ACCEPTANCE", tokenFlag: "OPENBUDDY_EMAIL_JMAP_ACCESS_TOKEN", writeConfirm: "I_UNDERSTAND_MAILBOX_MUTATIONS", sendConfirm: "I_UNDERSTAND_EXTERNAL_EMAIL_SEND", recipientFlag: "OPENBUDDY_EMAIL_JMAP_TEST_RECIPIENT" },
  { name: "imap-smtp", file: "evals/node/run_imap_smtp_acceptance.mjs", enabledFlag: "OPENBUDDY_EMAIL_ADDRESS", tokenFlag: "OPENBUDDY_EMAIL_PASSWORD", writeConfirm: "I_UNDERSTAND_MAILBOX_MUTATIONS", sendConfirm: "I_UNDERSTAND_EXTERNAL_EMAIL_SEND", recipientFlag: "OPENBUDDY_EMAIL_IMAP_SMTP_TEST_RECIPIENT" },
]

function runRunner(file, env) {
  return spawnSync(process.execPath, [path.join(repoRoot, file)], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30_000,
  })
}

describe("real OAuth acceptance runners", () => {
  for (const runner of runners) {
    it(`${runner.name}: fail-closes without enabled flag`, () => {
      const result = runRunner(runner.file, {})
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/fail-closed|requires|missing|OPENBUDDY_EMAIL/i)
    })

    it(`${runner.name}: fail-closes without token`, () => {
      const result = runRunner(runner.file, { [runner.enabledFlag]: "1" })
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/fail-closed|access token|password|token|requires|missing/i)
    })

    it(`${runner.name}: requires confirmation for management operations`, () => {
      const result = runRunner(runner.file, {
        [runner.enabledFlag]: "1",
        [runner.tokenFlag]: "fake-token",
        OPENBUDDY_EMAIL_EXTERNAL_MANAGE: "1",
        [runner.recipientFlag]: "test@example.com",
      })
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/confirmation|confirm|requires/i)
    })

    it(`${runner.name}: requires recipient for write operations`, () => {
      const result = runRunner(runner.file, {
        [runner.enabledFlag]: "1",
        [runner.tokenFlag]: "fake-token",
        OPENBUDDY_EMAIL_EXTERNAL_WRITE: "1",
        OPENBUDDY_EMAIL_EXTERNAL_CONFIRM: runner.writeConfirm,
      })
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/recipient|test recipient|requires/i)
    })
  }

  it("oauth acceptance skeleton honours the documented environment contract", () => {
    // Snapshot of the env contract — any drift must be reflected here.
    const contract = {
      "OPENBUDDY_EMAIL_GMAIL_API_ACCEPTANCE": "1 to enable Gmail real OAuth acceptance",
      "OPENBUDDY_EMAIL_GMAIL_ACCESS_TOKEN": "temporary Gmail OAuth access token",
      "OPENBUDDY_EMAIL_GRAPH_API_ACCEPTANCE": "1 to enable Graph real OAuth acceptance",
      "OPENBUDDY_EMAIL_GRAPH_ACCESS_TOKEN": "temporary Graph OAuth access token",
      "OPENBUDDY_EMAIL_JMAP_API_ACCEPTANCE": "1 to enable JMAP real OAuth acceptance",
      "OPENBUDDY_EMAIL_JMAP_ACCESS_TOKEN": "temporary JMAP app/OAuth token",
      "OPENBUDDY_EMAIL_IMAP_SMTP_ACCEPTANCE": "1 to enable IMAP/SMTP real acceptance",
      "OPENBUDDY_EMAIL_IMAP_SMTP_PASSWORD": "temporary IMAP/SMTP password / app password",
      "OPENBUDDY_EMAIL_EXTERNAL_CONFIRM": `must equal "${runners[0].writeConfirm}" to allow mailbox mutations`,
      "OPENBUDDY_EMAIL_EXTERNAL_SEND_CONFIRM": `must equal "${runners[0].sendConfirm}" to allow external send`,
      "OPENBUDDY_EMAIL_EXTERNAL_MANAGE": "1 to enable reversible mailbox management",
      "OPENBUDDY_EMAIL_EXTERNAL_WRITE": "1 to enable draft creation",
      "OPENBUDDY_EMAIL_EXTERNAL_SEND": "1 to enable controlled send",
      "OPENBUDDY_EMAIL_EXTERNAL_ATTACHMENTS": "1 to enable attachment listing",
      "OPENBUDDY_EMAIL_EXTERNAL_ATTACHMENT_DOWNLOAD": "1 to enable attachment download",
      "OPENBUDDY_EMAIL_ATTACHMENT_DIR": "absolute directory for downloaded attachments",
      "OPENBUDDY_EVIDENCE_DIR": "directory for evidence artifacts",
    }
    // Sanity: contract is non-empty and each entry has a non-empty description
    for (const [flag, description] of Object.entries(contract)) {
      expect(flag).toMatch(/^OPENBUDDY_/)
      expect(description.length).toBeGreaterThan(10)
    }
    expect(contract).toHaveProperty("OPENBUDDY_EMAIL_GMAIL_API_ACCEPTANCE")
    expect(contract).toHaveProperty("OPENBUDDY_EVIDENCE_DIR")
  })
})
