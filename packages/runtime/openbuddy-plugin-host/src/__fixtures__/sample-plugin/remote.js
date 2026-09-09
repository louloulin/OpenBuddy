/**
 * Sample remote contribution for `@fixture/sample-plugin`.
 *
 * Mirrors the `dsh-remote` / `openbuddy-remote` surface. Phase K.2 keeps
 * the shape identical so future L.x rounds can swap the loader without
 * rewriting the fixture.
 */
export default {
  contributes: {
    "openbuddy.service": {
      id: "samplePlugin",
      description: "Phase K.2 reference plugin — exposes samplePlugin service",
    },
  },
};