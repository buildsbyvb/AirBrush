# AirBrush 🖌️

Draw in the air with your hand (webcam + MediaPipe Hands), then turn your drawing into AI art
(oil painting, watercolour, realistic, ...). Runs fully in the browser.

- 1 finger = draw, 2 fingers = erase, palm = stop
- Done drawing -> description (type or voice) -> pick a style -> Generate
- Art gallery keeps the drawings and generated images you add, side by side, in your browser
- AI images use free Cloudflare Workers AI (fast), with the free AI Horde service as an automatic backup

## Look & feel (v13)
Black sky with sparse twinkling silver glitter and pastel brush strokes that paint themselves and vanish (canvas `#bg`, no video). White brush lettering (Yellowtail + Caveat Brush), translucent glass boxes, front page shows only the name and Get Started. You can delete `background.webm`, `background.mp4` and `background-poster.jpg` from the repo.
