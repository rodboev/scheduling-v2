// app/utils/capitalize.js

export function capitalize(companyName) {
  if (!companyName) return ''

  // Convert to lowercase first
  let result = companyName.toLowerCase()

  // List of words that should always be uppercase
  const alwaysUppercase = ['llc', 'lp', 'llp', 'ltd', 'scf', 'tr', 'fbo', 'dba', 'lic', 'nyc']

  result = result.replace(/\S+/g, function (word) {
    if (alwaysUppercase.includes(word)) {
      return word.toUpperCase()
    }
    // Capitalize first letter of each word, including common words
    return word.charAt(0).toUpperCase() + word.slice(1)
  })

  // Handle specific cases
  result = result
    // Capitalize after hyphens
    .replace(/-(.)/g, (_, char) => '-' + char.toUpperCase())
    // Handle Mc names
    .replace(/\bMc\s/g, 'Mc')
    .replace(/\bMc([a-z])/g, (_, char) => 'Mc' + char.toUpperCase())
    // Add periods after common abbreviations
    .replace(/\b(Inc|Assoc|Co|Jr|Sr|Tr|Bros)\b/g, '$1.')
    // Capitalize strings of 3 or more consonants (excluding words with vowels)
    .replace(/\b[B-DF-HJ-NP-TV-XZ]{3,}\b/g, (word) => word.toUpperCase())
    // Handle special cases like Roman numerals and other abbreviations
    .replace(/\b(Ii|Iii|Iv|Xiv|Yml|Us)\b/g, (word) => word.toUpperCase())

  // Handle slash-separated words (e.g., LLC/CO)
  result = result.replace(/(\S+)\/(\S+)/g, (match, word1, word2) => {
    return `${capitalize(word1)}/${capitalize(word2)}`
  })

  return result
}
