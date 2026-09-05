export default function externalPiExtension(pi) {
  pi.registerCommand("external-fixture", {
    description: "External DeepSeek Harness fixture command",
    handler: async () => undefined,
  });
}
