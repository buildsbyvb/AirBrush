# AirBrush 🖌️

### *Draw in the air. Let it become art.*

AirBrush is a creative web studio where your hand is the paintbrush. Raise a finger in front of your webcam, sketch in mid-air, and watch your drawing turn into a finished piece of artwork in the style of your choosing — an oil painting, a watercolour, a pencil study and more.

There is nothing to install, nothing to buy, and no account to create. Everything runs in your browser.

---

## ✨ How it works

1. **Open your webcam.** AirBrush follows 21 points on your hand in real time.
2. **Draw in the air.** Your finger becomes the brush, and your strokes appear on the canvas as you move.
3. **Describe your idea (optional).** Type it or simply say it aloud.
4. **Choose a style and press Generate.** The AI redraws your own sketch as finished artwork.
5. **Keep your favourites.** Save the drawing and the result side by side in your personal gallery.

## 🖐️ Gestures

| Gesture | What it does |
|---|---|
| ☝️ Index finger raised | **Draw** |
| ✌️ Index and middle fingers raised | **Erase** |
| 🖐️ Open palm | **Pause** (move freely without leaving a mark) |

## 🎨 Highlights

- **Real-time hand tracking** with a fine skeleton overlay, so you can see exactly what the camera sees.
- **Fifteen ready-made colours**, a custom colour wheel with a hex code field, and ten brush sizes.
- **Sketch-guided AI.** Your drawing acts as the blueprint, so the result keeps your shapes, proportions and colours.
- **Voice or written descriptions** to name your subject and request extras around it.
- **Ten output styles:** realistic, black and white, watercolour, oil painting, pencil sketch, cartoon, anime, pixel art, 3D render and comic book.
- **A personal art gallery** that stays in your own browser, with downloads for every piece.
- **A built-in guide** (the *Brush Up* tab) that explains every control for first-time visitors.

## 🧰 Built with

| Purpose | Technology |
|---|---|
| Hand tracking | [MediaPipe Hands](https://developers.google.com/mediapipe) by Google |
| Drawing | HTML5 Canvas |
| Voice input | Web Speech API |
| Image generation | Cloudflare Workers AI, with the AI Horde community network as an automatic backup |
| Gallery storage | IndexedDB (saved privately in your browser) |
| Front end | Plain HTML, CSS and JavaScript |
| Hosting | GitHub Pages |

Every service used is free.

## 🚀 Getting started

**Online:** open the live site, select *Pick Up the Brush*, and allow camera access when your browser asks.

**On your own computer:** the camera requires a secure or local address, so please serve the folder rather than opening the file directly.

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000` in Chrome, Edge or Safari.

## 📁 Project files

| File | Description |
|---|---|
| `index.html` | Page structure and content |
| `style.css` | The visual design (pastel studio theme) |
| `script.js` | Hand tracking, drawing, AI generation and gallery |
| `Atma-Medium.ttf`, `Atma-SemiBold.ttf` | The Atma typeface used for the front-page title |
| `OFL.txt` | The licence for the Atma typeface |

## 💡 For the best results

- Sit in a **well-lit room**; hand tracking is less accurate in low light.
- Use a **plain background** behind your hand.
- Keep your **whole hand in frame**, about an arm's length from the screen.
- Use **Chrome, Edge or Safari**. Voice input depends on browser support.
- Generation usually takes 5 to 20 seconds. If the backup service is needed, it may take a little longer.

## 🔭 What's next

Multi-hand collaboration on a shared canvas, 3D air drawing, short animated clips generated from a sketch, and an accessibility mode with gestures adapted for limited mobility.

## 💌 Feedback

Suggestions are warmly welcomed. Please use the feedback form on the site to share what you would like to see improved or added.

## 🙏 Credits

- Created by **Vaibhavi Jadhav**.
- Hand tracking by Google MediaPipe.
- The Atma typeface is © The Atma Project Authors and is used under the SIL Open Font License 1.1 (see `OFL.txt`).

Thank you for visiting AirBrush. We hope you enjoy creating something beautiful. 🎨
