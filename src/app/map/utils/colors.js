import Color from 'color'

// Generate a rainbow spectrum of colors using HSL
const generateSpectrum = count => {
  const colors = {}

  // Generate main spectrum with varying saturation and lightness
  for (let i = 0; i < count; i++) {
    const hue = Math.round((i * 360) / count)

    // Vary saturation and lightness based on hue ranges
    let saturation, lightness

    // Reds (0-30°)
    if (hue <= 30) {
      saturation = 80 + Math.random() * 15
      lightness = 45 + Math.random() * 15
    }
    // Oranges/Yellows (31-90°)
    else if (hue <= 90) {
      saturation = 75 + Math.random() * 15
      lightness = 50 + Math.random() * 15
    }
    // Greens (91-150°)
    else if (hue <= 150) {
      saturation = 65 + Math.random() * 20
      lightness = 40 + Math.random() * 15
    }
    // Cyans (151-210°)
    else if (hue <= 210) {
      saturation = 70 + Math.random() * 20
      lightness = 45 + Math.random() * 15
    }
    // Blues (211-270°)
    else if (hue <= 270) {
      saturation = 75 + Math.random() * 15
      lightness = 50 + Math.random() * 10
    }
    // Purples/Magentas (271-360°)
    else {
      saturation = 70 + Math.random() * 20
      lightness = 45 + Math.random() * 15
    }

    const colorName = `spectrum${i + 1}`
    colors[colorName] = Color.hsl(hue, saturation, lightness).hex()
  }

  // Add essential named colors
  const namedColors = {
    red: '#d63e2a',
    green: '#72b026',
    blue: '#38aadd',
    purple: '#9c2bcb',
    orange: '#f69730',
    pink: '#df8dc3',
    teal: '#008080',
    brown: '#a52a2a',
    navy: '#000080',
    gold: '#ffd700',
    crimson: '#dc143c',
    indigo: '#4b0082',
    maroon: '#800000',
    olive: '#808000',
    coral: '#ff7f50',
    violet: '#ee82ee',
  }

  // Add neutral colors
  const neutralColors = {
    gray: '#808080',
    darkgray: '#404040',
    silver: '#c0c0c0',
  }

  return { ...colors, ...namedColors, ...neutralColors }
}

const baseColors = generateSpectrum(24) // 24 colors for a rich spectrum

const MAX_LIGHTNESS = 0.85 // Prevent colors from getting too close to white
const MIN_COLOR_DIFFERENCE = 30 // Minimum Delta E difference between colors

function calculateDeltaE(color1, color2) {
  // Convert to Lab color space for better perceptual difference calculation
  const lab1 = Color(color1).lab().array()
  const lab2 = Color(color2).lab().array()

  // Simple Euclidean distance in Lab space
  // Not as accurate as CIEDE2000 but sufficient for our needs
  const deltaL = lab1[0] - lab2[0]
  const deltaA = lab1[1] - lab2[1]
  const deltaB = lab1[2] - lab2[2]

  return Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB)
}

function isColorTooSimilar(newColor, existingColors) {
  for (const existingColor of existingColors) {
    const deltaE = calculateDeltaE(newColor, existingColor)
    if (deltaE < MIN_COLOR_DIFFERENCE) return true
  }
  return false
}

export const COLORS = Object.entries(baseColors).reduce((acc, [key, value]) => {
  try {
    const color = Color(value)
    const darkColor = color.darken(0.1).hex()

    // Calculate lightened color and ensure it doesn't get too light
    const lightColor = color.lighten(0.5)
    const finalLightColor =
      lightColor.lightness() > MAX_LIGHTNESS * 100
        ? color.lightness(MAX_LIGHTNESS * 100).hex()
        : lightColor.hex()

    // Check if colors are too similar to existing ones
    const existingColors = Object.values(acc)
    if (!isColorTooSimilar(darkColor, existingColors)) {
      acc[`${key}Dark`] = darkColor
    }
    if (!isColorTooSimilar(finalLightColor, existingColors)) {
      acc[`${key}Light`] = finalLightColor
    }
  } catch (error) {
    console.warn(`Failed to modify color: ${key}`)
  }
  return acc
}, {})
