# AirBrush 🖌️

Draw in the air with your hand (webcam + MediaPipe Hands), then turn your drawing into AI art
(oil painting, watercolour, realistic, ...). Runs fully in the browser.

- 1 finger = draw, 2 fingers = erase, palm = stop
- Done drawing -> description (type or voice) -> pick a style -> Generate
- Art gallery keeps the drawings and generated images you add, side by side, in your browser
- AI images use free Cloudflare Workers AI (fast), with the free AI Horde service as an automatic backup


## Background video
`background.webm` and `background.mp4` are web-sized (1920x1080, muted, no audio) copies of the uploaded 4K video; `background-poster.jpg` is its first frame, shown only until playback starts.
Keep all of these files next to `index.html`. Reduced-motion users get a paused frame instead of motion.
