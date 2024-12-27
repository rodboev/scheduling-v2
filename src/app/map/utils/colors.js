import Color from 'color'

// Generate a rainbow spectrum of colors using HSL
const generateSpectrum = count => {
  const colors = {}
  const saturation = 85 // Percentage
  const lightness = 55 // Percentage

  // Generate main spectrum
  for (let i = 0; i < count; i++) {
    const hue = Math.round((i * 360) / count)
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
const MIN_COLOR_DIFFERENCE = 10 // Minimum Delta E difference between colors

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
