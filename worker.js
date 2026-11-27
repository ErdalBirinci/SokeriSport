/**
 * SokeriSport — Worker entry point that serves the static assets.
 * All routing is delegated to env.ASSETS; the app is fully client-side.
 */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
