export default function marketplaceBundleExtension(pi) {
  pi.registerCommand?.("marketplace-bundle-test", {
    description: "Installed via marketplace install E2E",
    handler: () => "loaded by marketplace test",
  });
}
