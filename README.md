# AirBrush 🖌️

Draw in the air with your hand (webcam + MediaPipe Hands), then turn your drawing into AI art
(oil painting, watercolour, realistic, ...). Runs fully in the browser.

- 1 finger = draw, 2 fingers = erase, palm = stop
- Done drawing -> description (type or voice) -> pick a style -> Generate
- Art gallery keeps the drawings and generated images you add, side by side, in your browser
- AI images use free Cloudflare Workers AI (fast), with the free AI Horde service as an automatic backup

## Look & feel (v14)
Black stage with one or two bold, bristly brush strokes at a time that paint themselves across the screen and vanish (canvas `#bg`, no video, no stars). Ombre lettering (Playfair Display italic + Jost), translucent boxes with ombre hairline borders, square colour swatches, hairline "tech HUD" hand skeleton, and an MS Paint style brush cursor. You can delete `background.webm`, `background.mp4` and `background-poster.jpg` from the repo.
