// Deep Roon MCP's icon (12 Oct 2026, René: "something fun, with a wink to Roon"): not Roon's logo — the double "oo" of the
// name as two eyes, the right one winking, under a few lines of water in deep blue. 512 × 512, rounded square.
//   swift scripts/icon.swift        (from the repository root) → icon.png
import AppKit

let size = 512.0
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let c = NSGraphicsContext.current!.cgContext
func rgb(_ hex: Int, _ a: CGFloat = 1) -> NSColor { NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: a) }

// The deep: a rounded square, light at the surface, dark at the bottom.
let tile = NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: size, height: size), xRadius: 112, yRadius: 112)
tile.addClip()
NSGradient(colors: [rgb(0x041330), rgb(0x0B3A6E), rgb(0x1B6FA8)], atLocations: [0, 0.62, 1], colorSpace: .sRGB)!
  .draw(in: NSRect(x: 0, y: 0, width: size, height: size), angle: 90)

// The surface: three gentle waves near the top, fading as they go deeper.
for (i, y) in [430.0, 398.0, 366.0].enumerated() {
  let wave = NSBezierPath()
  wave.move(to: NSPoint(x: -20, y: y))
  var x = -20.0
  while x < size + 20 { wave.curve(to: NSPoint(x: x + 64, y: y), controlPoint1: NSPoint(x: x + 16, y: y + 14), controlPoint2: NSPoint(x: x + 48, y: y - 14)); x += 64 }
  wave.lineWidth = 10 - CGFloat(i) * 2
  rgb(0xBFE6FF, 0.55 - CGFloat(i) * 0.15).setStroke()
  wave.lineCapStyle = .round
  wave.stroke()
}

// A few bubbles rising.
for (x, y, r, a) in [(352.0, 318.0, 9.0, 0.55), (378.0, 286.0, 6.0, 0.45), (338.0, 270.0, 4.5, 0.35)] {
  let b = NSBezierPath(ovalIn: NSRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))
  b.lineWidth = 3; rgb(0xDFF3FF, a).setStroke(); b.stroke()
}

// The eyes: the "oo". Left open — a ring with a pupil and a glint; right winking — a closed, smiling arc.
let eyeY = 196.0, ringR = 70.0, line = 26.0
rgb(0xF4FBFF).setStroke()
let left = NSBezierPath(ovalIn: NSRect(x: 150 - ringR, y: eyeY - ringR, width: 2 * ringR, height: 2 * ringR))
left.lineWidth = line; left.stroke()
rgb(0xF4FBFF).setFill()
NSBezierPath(ovalIn: NSRect(x: 150 - 22, y: eyeY - 22 - 6, width: 44, height: 44)).fill()
rgb(0x0B3A6E).setFill()
NSBezierPath(ovalIn: NSRect(x: 150 + 2, y: eyeY + 4, width: 12, height: 12)).fill()

let wink = NSBezierPath()
wink.move(to: NSPoint(x: 362 - ringR, y: eyeY + 6))
wink.curve(to: NSPoint(x: 362 + ringR, y: eyeY + 6), controlPoint1: NSPoint(x: 362 - ringR * 0.45, y: eyeY - 46), controlPoint2: NSPoint(x: 362 + ringR * 0.45, y: eyeY - 46))
wink.lineWidth = line; wink.lineCapStyle = .round
rgb(0xF4FBFF).setStroke(); wink.stroke()
// Lashes on the wink, for the wink to read as one.
for (dx, dy) in [(-46.0, -30.0), (0.0, -44.0), (46.0, -30.0)] {
  let l = NSBezierPath()
  let base = NSPoint(x: 362 + dx * 0.78, y: eyeY + dy * 0.78 + 4)
  l.move(to: base); l.line(to: NSPoint(x: base.x + dx * 0.5, y: base.y + dy * 0.62))
  l.lineWidth = 12; l.lineCapStyle = .round; l.stroke()
}

NSGraphicsContext.restoreGraphicsState()
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "icon.png"))
print("icon.png")
