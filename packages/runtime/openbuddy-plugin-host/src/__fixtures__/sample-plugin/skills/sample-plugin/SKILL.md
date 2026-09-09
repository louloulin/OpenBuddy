---
name: sample-plugin
description: Phase K.2 reference skill — exercises the `pi.skills` discovery path.
---

# Sample Plugin Skill

This skill exists so the `@fixture/sample-plugin` fixture exercises every
track the OpenBuddyPlugin SDK (Phase K.1) recognises:

- **pi**: declared via `package.json#pi.extensions` (see
  `../extensions/index.js`)
- **harness**: declared via `package.json#openbuddy.bundle.patch`
  (see `../cordis.patch.yml`)
- **slot**: declared via `package.json#openbuddy.client`
  (see `../client.js`)
- **cordis**: declared via `package.json#openbuddy.bundle` + the patch
  (same as harness, exercised via the `index.js` default export)

Phase K.2 keeps the same shape so this fixture is also a regression
anchor for the v6 plan's "实际装载依然走 PI `loadExtensions()`" invariant.