// src/app/utils/capitalize.js

export function capitalize(companyName) {
  // Convert to lowercase first
  let result = companyName.toLowerCase()

  // List of words that should always be uppercase
  const alwaysUppercase = ['llc', 'lp', 'llp', 'inc', 'co', 'ltd', 'scf', 'tr', 'fbo', 'dba']

  // Capitalize first letter of each word, except for common words
  const commonWords = /^(a|an|and|as|at|but|by|en|for|if|in|nor|of|on|or|per|the|to|vs\.?|via)$/i

  result = result.replace(/\S+/g, function (word) {
    if (alwaysUppercase.includes(word)) {
      return word.toUpperCase()
    }
    if (commonWords.test(word)) {
      return word
    }
    // Handle words with apostrophes
    return word.replace(
      /(?:^|\s)(\S)(\S*?)(?:'(\S)(\S*?))?(?=\s|$)/g,
      (match, firstChar, restOfWord, afterApostrophe, afterApostropheRest) => {
        let capitalized = firstChar.toUpperCase() + restOfWord
        if (afterApostrophe) {
          capitalized +=
            "'" +
            (afterApostropheRest
              ? afterApostrophe.toUpperCase() + afterApostropheRest
              : afterApostrophe)
        }
        return capitalized
      },
    )
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
