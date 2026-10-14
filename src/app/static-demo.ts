// The GitHub Pages build (VITE_STATIC_DEMO=1) has no local server: the yt-dlp bridges and the assistant are off.
export const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === '1';
export const STATIC_DEMO_NOTE = 'This is the web demo, without the local server Claude runs on. Clone the repo and run `npm run dev` to use the assistant and the director.';
