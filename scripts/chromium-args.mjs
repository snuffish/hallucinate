// Chromium flags for headless runs (the e2e specs, perf/ and the screenshots): AudioContext without a
// user gesture, and software WebGL2 through SwiftShader.
export const AUTOPLAY_ARG = '--autoplay-policy=no-user-gesture-required';
export const SOFTWARE_GL_ARGS = [AUTOPLAY_ARG, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
